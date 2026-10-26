import { Interface, keccak256 } from 'ethers';
import { readFile } from 'node:fs/promises';
import { abiInterface, tagaiRegistry } from './tagai.mjs';

export class TradeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const requireTrade = (condition, code, message) => {
  if (!condition) throw new TradeError(code, message);
};

export function createRpc(url = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org', fetcher = fetch) {
  let id = 0;
  return async (method, params) => {
    let response;
    try {
      response = await fetcher(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new TradeError('RPC_UNAVAILABLE', 'The BSC data connection is unavailable. Retry the query before trading.');
    }
    requireTrade(response.ok, 'RPC_UNAVAILABLE', 'The BSC data provider rejected the request.');
    const body = await response.json();
    if (body.error) throw new TradeError('RPC_ERROR', body.error.message || 'The chain request failed.', { rpcCode: body.error.code, revertData: body.error.data });
    requireTrade(Object.hasOwn(body, 'result'), 'RPC_INVALID_RESPONSE', 'The chain provider returned an incomplete response.');
    return body.result;
  };
}

const registry = tagaiRegistry();
const multi = new Interface(JSON.parse(await readFile(new URL('../../abis/multicall3.json', import.meta.url), 'utf8')));
export const MULTICALL_RUNTIME_HASH = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891';
const capacityError = error => /gas|response.{0,12}(size|large)|limit exceeded|too many|payload too large|request entity too large/i.test(error.message);

export class ChainReader {
  constructor(rpc = createRpc(), { multicallRuntimeHash = MULTICALL_RUNTIME_HASH, now = () => Math.floor(Date.now() / 1000) } = {}) {
    this.rpc = rpc; this.multicallRuntimeHash = multicallRuntimeHash; this.now = now;
  }

  async snapshot() {
    requireTrade(BigInt(await this.rpc('eth_chainId', [])) === 56n, 'WRONG_CHAIN', 'This trade requires BNB Smart Chain.');
    const header = await this.rpc('eth_getBlockByNumber', ['latest', false]);
    requireTrade(header?.number && header.hash && header.timestamp, 'SNAPSHOT_UNAVAILABLE', 'A complete chain snapshot is unavailable.');
    const snapshot = { blockTag: header.number, blockHash: header.hash, timestamp: Number(BigInt(header.timestamp)) };
    requireTrade(Math.abs(this.now() - snapshot.timestamp) <= 120, 'STALE_CHAIN_DATA', 'The chain provider is returning stale data. Refresh the connection before trading.');
    // One independent deployment-identity read, not a fan-out of contract calls.
    const code = await this.rpc('eth_getCode', [registry.multicall, snapshot.blockTag]);
    requireTrade(code !== '0x' && keccak256(code) === this.multicallRuntimeHash, 'MULTICALL_UNVERIFIED', 'The required chain data reader could not be verified.');
    return snapshot;
  }

  async verifySnapshot(snapshot) {
    const header = await this.rpc('eth_getBlockByNumber', [snapshot.blockTag, false]);
    requireTrade(header?.hash === snapshot.blockHash, 'SNAPSHOT_REORG', 'Chain data changed during the query. Refresh the quote.');
  }

  async batch(snapshot, specs) {
    const labels = new Set();
    const entries = [];
    for (const spec of specs) {
      requireTrade(spec.label && !labels.has(spec.label), 'INVALID_READ', 'Duplicate chain data fields were requested.');
      labels.add(spec.label);
      const abi = await abiInterface(spec.abi);
      const method = abi.getFunction(spec.method);
      requireTrade(method && (['view', 'pure'].includes(method.stateMutability) || method.name === 'quoteExactInputSingle'), 'INVALID_READ', 'A transaction cannot be used as a batch state read.');
      entries.push({ ...spec, iface: abi, call: { target: spec.target, allowFailure: true, callData: abi.encodeFunctionData(method, spec.args ?? []) } });
    }
    const rows = [];
    const run = async chunk => {
      if (!chunk.length) return;
      let raw;
      try {
        raw = await this.rpc('eth_call', [{ to: registry.multicall, data: multi.encodeFunctionData('aggregate3', [chunk.map(s => s.call)]) }, snapshot.blockTag]);
      } catch (error) {
        if (chunk.length > 1 && capacityError(error)) {
          const middle = Math.ceil(chunk.length / 2);
          await run(chunk.slice(0, middle));
          await run(chunk.slice(middle));
          return;
        }
        throw error;
      }
      const decoded = multi.decodeFunctionResult('aggregate3', raw)[0];
      requireTrade(decoded.length === chunk.length, 'INCOMPLETE_STATE', 'Required chain data is incomplete.');
      for (let i = 0; i < decoded.length; i++) rows.push([chunk[i], decoded[i]]);
    };
    for (let i = 0; i < entries.length; i += 40) await run(entries.slice(i, i + 40));
    const result = {};
    for (const [spec, row] of rows) {
      try {
        if (!row.success) throw new Error('subcall reverted');
        const values = spec.iface.decodeFunctionResult(spec.method, row.returnData);
        result[spec.label] = { ok: true, value: values.length === 1 ? values[0] : values };
      } catch {
        requireTrade(spec.required !== true, 'INCOMPLETE_STATE', 'Required token data could not be read. Refresh before trading.');
        result[spec.label] = { ok: false, value: null };
      }
    }
    return result;
  }

  async simulate(snapshot, transaction) {
    const params = { from: transaction.from, to: transaction.to, value: `0x${BigInt(transaction.valueWei).toString(16)}`, data: transaction.inputData };
    // A single complete transaction simulation must preserve the actual caller.
    try {
      return await this.rpc('eth_call', [params, snapshot.blockTag]);
    } catch (error) {
      throw new TradeError('SIMULATION_FAILED', 'This transaction could not be simulated successfully. No transaction was sent.', error.details);
    }
  }
}
