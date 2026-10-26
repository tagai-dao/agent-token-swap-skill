import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, Interface, ZeroAddress, keccak256 } from 'ethers';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abiInterface, tagaiRegistry } from '../scripts/lib/tagai.mjs';
import { ChainReader, createRpc, TradeError } from '../scripts/lib/live-rpc.mjs';
import { TagaiLive } from '../scripts/lib/tagai-live.mjs';
import { PlanStore, WalletExecution } from '../scripts/lib/wallet-execution.mjs';

const registry = tagaiRegistry();
const release = registry.versions.find(v => v.id === '15');
const token = '0x1111111111111111111111111111111111111111';
const wallet = '0x2222222222222222222222222222222222222222';
const hash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const now = 1800000000;
const coder = AbiCoder.defaultAbiCoder();
const multi = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])']);
const interfaces = await Promise.all(['abis/tagai/token-v16.json', 'abis/tagai/read-interfaces.json', 'abis/tagai/pancake.json', 'abis/erc20.json'].map(abiInterface));
const eventAbi = await abiInterface('abis/tagai/token-v15.json');

function fixture(settings = {}) {
  const state = { listed: false, pending: false, handle: 'registered', allowance: 0n, permitAmount: 0n, permitExpiration: 0n, capacity: false, ...settings };
  const trace = [], walletTrace = [];
  const key = { currency0: ZeroAddress, currency1: token, hooks: release.hook, poolManager: registry.dex.clPoolManager, fee: 0, parameters: `0x${'00'.repeat(32)}` };
  const poolId = keccak256(coder.encode(['tuple(address,address,address,address,uint24,bytes32)'], [Object.values(key)]));
  const header = () => ({ number: '0x100', hash: state.reorg ? `0x${'ef'.repeat(32)}` : blockHash, timestamp: `0x${now.toString(16)}` });
  const transport = async (url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(Array.isArray(request), false);
    trace.push(request);
    const { method, params } = request;
    let result;
    if (method === 'eth_chainId') result = state.wrongChain ? '0x1' : '0x38';
    else if (method === 'eth_getBlockByNumber') result = header();
    else if (method === 'eth_getCode') result = params[0].toLowerCase() === registry.multicall.toLowerCase() ? '0x6000' : `0x363d3d373d3d3d363d73${release.tokenImplementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
    else if (method === 'eth_estimateGas') result = '0x249f0';
    else if (method === 'eth_getBalance') result = state.noGas ? '0x0' : '0xde0b6b3a7640000';
    else if (method === 'eth_gasPrice') result = '0x1';
    else if (method === 'eth_blockNumber') result = '0x102';
    else if (method === 'eth_getTransactionReceipt') result = state.receipt ?? null;
    else if (method === 'eth_getTransactionByHash') result = state.recoveryTransaction ?? null;
    else if (method === 'eth_call') {
      if (params[0].to.toLowerCase() !== registry.multicall.toLowerCase()) {
        assert.equal(params[0].from.toLowerCase(), wallet);
        if (state.simulationFails) return { ok: true, json: async () => ({ error: { code: -32000, message: 'execution reverted' } }) };
        result = '0x';
      } else {
        const calls = multi.decodeFunctionData('aggregate3', params[0].data)[0];
        if (state.capacity && calls.length > 2) return { ok: true, json: async () => ({ error: { code: -32000, message: 'response size limit exceeded' } }) };
        const rows = calls.map(child => {
          let iface, parsed;
          for (const candidate of interfaces) { try { parsed = candidate.parseTransaction({ data: child.callData }); if (parsed) { iface = candidate; break; } } catch {} }
          assert.ok(parsed, `unknown selector ${child.callData.slice(0, 10)}`);
          if (state.failRequired === parsed.name) return [false, '0x'];
          let output;
          switch (parsed.name) {
            case 'createdTokens': output = [child.target.toLowerCase() === release.pump.toLowerCase()]; break;
            case 'name': case 'symbol': output = ['AIPRO']; break;
            case 'decimals': output = [18]; break;
            case 'listed': output = [state.listed]; break;
            case 'listingPending': output = [state.pending]; break;
            case 'bondingCurveSupply': output = [1000000n * 10n ** 18n]; break;
            case 'bondingCurve': output = [release.pump]; break;
            case 'getBuyFeeRatios': output = [30, 30]; break;
            case 'getFeeRatio': output = [[30, 30]]; break;
            case 'tokenImplementation': output = [release.tokenImplementation]; break;
            case 'balanceOf': output = [5000n * 10n ** 18n]; break;
            case 'getPrice': output = [parsed.args[1] / 1000000000n]; break;
            case 'getBuyAmountByValue': output = [parsed.args[1] * 1000000000n]; break;
            case 'handleOf': output = [state.handle]; break;
            case 'v4PoolId': output = [poolId]; break;
            case 'vault': output = [registry.dex.vault]; break;
            case 'listingHook': output = [release.hook]; break;
            case 'listingPoolParameters': output = [key.parameters]; break;
            case 'clPoolManager': output = [registry.dex.clPoolManager]; break;
            case 'poolIdToPoolKey': output = [Object.values(key)]; break;
            case 'getSlot0': output = [2n ** 96n, 0, 0, 0]; break;
            case 'getLiquidity': output = [1000000000000000000n]; break;
            case 'quoteExactInputSingle': output = [parsed.args[0].exactAmount * 2n, 150000n]; break;
            case 'allowance': output = parsed.args.length === 3 ? [state.permitAmount, state.permitExpiration, 0] : [state.allowance]; break;
            default: throw new Error(`unhandled method ${parsed.name}`);
          }
          return [true, iface.encodeFunctionResult(parsed.name, output)];
        });
        result = multi.encodeFunctionResult('aggregate3', [rows]);
      }
    } else throw new Error(`unexpected RPC method: ${method}`);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
  };
  const rpc = createRpc('https://test.invalid', transport);
  const reader = new ChainReader(rpc, { multicallRuntimeHash: keccak256('0x6000'), now: () => now });
  const fetcher = async url => ({ ok: true, json: async () => {
    assert.match(url, /community\/search\?tick=AIPRO$/);
    return [{ chainId: 56, tick: 'AIPRO', name: 'AIPRO', token, isImport: 0 }];
  } });
  const live = new TagaiLive({ reader, fetcher, now: () => now });
  const walletRun = async args => {
    walletTrace.push(args);
    if (args[0] === 'wallet' && args[1] === 'status') return { status: 'CONNECTED' };
    if (args[0] === 'wallet' && args[1] === 'address') return { addresses: [{ binanceChainId: '56', address: wallet }] };
    if (args[0] === 'wallet' && args[1] === 'settings') return { devMode: { enabled: !state.noDevMode } };
    if (args[0] === 'wallet' && args[1] === 'tx-lock') return { status: state.walletLocked ? 'LOCKED' : 'UNLOCKED' };
    if (args[0] === 'contract-call' && args[1] === 'preview') {
      if (state.previewBlocked) throw new TradeError('WALLET_ERROR', 'High risk transaction');
      return { requestId: 'preview-1', expiresAt: (now + 120) * 1000, parsedTx: { transactionType: 'ContractCall' }, risks: { riskDetails: [] }, simulationResult: { simulationCode: '000000000', authorityChanges: [] } };
    }
    if (args[0] === 'contract-call' && args[1] === 'execute') {
      if (state.unknownSubmission) throw new TradeError('WALLET_RESPONSE_UNKNOWN', 'response timeout');
      return { orderId: 'order-1', status: state.appPending ? 'PENDING_CONFIRMATION' : 'BROADCASTED', txHash: state.appPending ? null : hash };
    }
    if (args[0] === 'wallet' && args[1] === 'tx-history') return { transactions: state.history ?? (state.appApproved ? [{ orderId: 'order-1', txHash: hash }] : []) };
    throw new Error(`unexpected wallet command ${args}`);
  };
  return { live, reader, trace, walletTrace, walletRun, state };
}

const intent = { token: 'AIPRO', side: 'sell', amount: '1000' };
async function executionFixture(settings, run) {
  const f = fixture(settings);
  const directory = await mkdtemp(path.join(tmpdir(), 'tagai-live-'));
  try {
    const execution = new WalletExecution({ live: f.live, wallet: f.walletRun, store: new PlanStore(directory), now: () => now * 1000 });
    await run({ ...f, execution, store: execution.store });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('ticker info resolves a unique match and reads platform, address, price and phase without a wallet', async () => {
  const f = fixture();
  const info = await f.live.inspect('AIPRO');
  assert.equal(info.summary.contractAddress.toLowerCase(), token);
  assert.equal(info.summary.platform, 'TagAI');
  assert.equal(info.summary.market, 'internal');
  assert.equal(info.summary.referencePrice.amount, '0.000000001');
  assert.equal('version' in info.summary, false);
  assert.equal(f.walletTrace.length, 0);
  await assert.rejects(f.live.inspect('0x1234'), error => error.code === 'INVALID_TOKEN_ADDRESS');
});

test('live batch transport uses only Multicall with exact targets and pinned block across phases/chunks/retries', async () => {
  const f = fixture({ capacity: true });
  const quote = await f.live.quote(intent);
  assert.equal(quote.summary.expectedOutput.amount, '0.000000994');
  const calls = f.trace.filter(r => r.method === 'eth_call');
  assert.ok(calls.length > 5);
  for (const request of calls) {
    assert.equal(request.params[0].to, registry.multicall);
    assert.equal(request.params[1], '0x100');
    const children = multi.decodeFunctionData('aggregate3', request.params[0].data)[0];
    assert.ok(children.length > 0);
    for (const child of children) assert.equal(child.allowFailure, true);
  }
  const proof = multi.decodeFunctionData('aggregate3', calls[0].params[0].data)[0];
  assert.deepEqual(Array.from(proof).map(x => x.target.toLowerCase()), registry.versions.filter(v => v.issuanceGetterDocumented && v.marketFamily !== 'import').map(v => v.pump.toLowerCase()));
});

test('required live state failure stops quoting and never falls back to independent contract calls', async () => {
  const f = fixture({ failRequired: 'getFeeRatio' });
  await assert.rejects(f.live.quote(intent), error => error.code === 'INCOMPLETE_STATE');
  assert.ok(f.trace.filter(x => x.method === 'eth_call').every(x => x.params[0].to === registry.multicall));
});

test('wrong chain, migration and chain reorganization stop the request', async () => {
  await assert.rejects(fixture({ wrongChain: true }).live.inspect(token), error => error.code === 'WRONG_CHAIN');
  await assert.rejects(fixture({ pending: true }).live.quote(intent), error => error.code === 'MARKET_MIGRATING');
  const f = fixture();
  const snapshot = await f.reader.snapshot();
  f.state.reorg = true;
  await assert.rejects(f.reader.verifySnapshot(snapshot), error => error.code === 'SNAPSHOT_REORG');
});

test('buyer qualification is checked only for buys; sales and reference-price queries remain usable', async () => {
  const f = fixture({ handle: '' });
  await f.live.inspect('AIPRO');
  await f.live.quote({ ...intent, wallet });
  await assert.rejects(f.live.quote({ token, side: 'buy', amount: '0.001', wallet }), error => error.code === 'BUYER_INELIGIBLE');
});

test('holding percentages use the actual balance and fees are rounded individually once', async () => {
  const q = await fixture().live.quote({ token, side: 'sell', amount: '20%', wallet });
  assert.equal(q.amountIn, 1000n * 10n ** 18n);
  assert.equal(q.summary.expectedOutput.amount, '0.000000994');
  assert.equal(q.summary.minimumOutput.amount, '0.00000098406');
});

test('Infinity quotes use the verified listing pool and Hook-inclusive amount quote without double fees', async () => {
  const f = fixture({ listed: true });
  const q = await f.live.quote({ token, side: 'buy', amount: '0.001', wallet });
  assert.equal(q.info.pool.kind, 'infinity');
  assert.equal(q.quoteOut, 2000000000000000n);
  const tx = await f.live.transaction(q, wallet);
  assert.equal(tx.to, registry.dex.universalRouter);
  assert.equal(tx.valueWei, '1000000000000000');
});

test('prepare simulates the real-wallet transaction and creates one wallet preview without executing', async () => {
  await executionFixture({}, async f => {
    const preview = await f.execution.prepare(intent);
    assert.equal(preview.status, 'PREVIEWED');
    assert.equal(preview.confirmationRequired, true);
    assert.equal(preview.summary.platform, 'TagAI');
    assert.equal('version' in preview.summary, false);
    assert.equal(f.walletTrace.filter(x => x[0] === 'contract-call' && x[1] === 'preview').length, 1);
    assert.equal(f.walletTrace.filter(x => x[1] === 'execute').length, 0);
    const simulations = f.trace.filter(x => x.method === 'eth_call' && x.params[0].to.toLowerCase() === token);
    assert.equal(simulations.length, 1);
    assert.equal(simulations[0].params[0].from.toLowerCase(), wallet);
  });
});

test('confirmation executes the exact preview once; a second execute is rejected', async () => {
  await executionFixture({}, async f => {
    const preview = await f.execution.prepare(intent);
    await assert.rejects(f.execution.execute(preview.planId), error => error.code === 'CONFIRMATION_REQUIRED');
    const result = await f.execution.execute(preview.planId, { confirmed: true });
    assert.equal(result.status, 'SUBMITTED');
    assert.equal(result.transactionHash, hash);
    assert.deepEqual(f.walletTrace.find(x => x[1] === 'execute'), ['contract-call', 'execute', '--requestId', 'preview-1']);
    await assert.rejects(f.execution.execute(preview.planId, { confirmed: true }), error => error.code === 'EXECUTION_ALREADY_STARTED');
    assert.equal(f.walletTrace.filter(x => x[1] === 'execute').length, 1);
  });
});

test('failed simulation, risk block and insufficient gas cannot reach execution', async () => {
  for (const settings of [{ simulationFails: true }, { previewBlocked: true }, { noGas: true }, { noDevMode: true }, { walletLocked: true }]) {
    await executionFixture(settings, async f => {
      await assert.rejects(f.execution.prepare(intent));
      assert.equal(f.walletTrace.filter(x => x[1] === 'execute').length, 0);
    });
  }
});

test('expired or modified previews cannot be submitted', async () => {
  await executionFixture({}, async f => {
    const preview = await f.execution.prepare(intent);
    const plan = await f.store.load(preview.planId);
    plan.transaction.valueWei = '1';
    await f.store.save(plan);
    await assert.rejects(f.execution.execute(preview.planId, { confirmed: true }), error => error.code === 'PREVIEW_CHANGED');
  });
  await executionFixture({}, async f => {
    const preview = await f.execution.prepare(intent);
    f.execution.now = () => (now + 100) * 1000;
    await assert.rejects(f.execution.execute(preview.planId, { confirmed: true }), error => error.code === 'PREVIEW_EXPIRED');
    assert.equal(f.walletTrace.filter(x => x[1] === 'execute').length, 0);
  });
  await executionFixture({}, async f => {
    const preview = await f.execution.prepare(intent);
    let checks = 0;
    f.execution.now = () => (++checks === 1 ? now : now + 100) * 1000;
    await assert.rejects(f.execution.execute(preview.planId, { confirmed: true }), error => error.code === 'PREVIEW_EXPIRED');
    assert.equal(f.walletTrace.filter(x => x[1] === 'execute').length, 0);
  });
});

test('ambiguous wallet submission is persisted and never automatically executed again', async () => {
  await executionFixture({ unknownSubmission: true }, async f => {
    const preview = await f.execution.prepare(intent);
    await assert.rejects(f.execution.execute(preview.planId, { confirmed: true }), error => error.code === 'EXECUTION_UNKNOWN');
    assert.equal((await f.store.load(preview.planId)).status, 'UNKNOWN');
    await assert.rejects(f.execution.execute(preview.planId, { confirmed: true }), error => error.code === 'EXECUTION_ALREADY_STARTED');
    assert.equal(f.walletTrace.filter(x => x[1] === 'execute').length, 1);
  });
});

test('pending App confirmation recovers by wallet order identity and confirmed receipts use actual sale events', async () => {
  await executionFixture({ appPending: true }, async f => {
    const preview = await f.execution.prepare(intent);
    const submitted = await f.execution.execute(preview.planId, { confirmed: true });
    assert.equal(submitted.status, 'AWAITING_APP');
    assert.equal(submitted.transactionHash, null);
    f.state.appApproved = true;
    const event = eventAbi.encodeEventLog(eventAbi.getEvent('Trade'), [wallet, ZeroAddress, false, 1000n * 10n ** 18n, 1000000000000n, 3000000000n, 3000000000n]);
    f.state.receipt = { blockNumber: '0x100', blockHash, status: '0x1', logs: [{ address: token, ...event }] };
    const status = await f.execution.status(preview.planId);
    assert.equal(status.status, 'CONFIRMED');
    assert.equal(status.actualOutput.amount, '0.000000994');
    assert.equal(f.walletTrace.filter(x => x[1] === 'execute').length, 1);
  });
});

test('external approval is a separate preview with finite authority, not a completed trade', async () => {
  await executionFixture({ listed: true }, async f => {
    const preview = await f.execution.prepare(intent);
    assert.equal(preview.summary.step, 'Token approval required before the swap');
    assert.equal(preview.summary.approval.amount, '1000.0');
    const plan = await f.store.load(preview.planId);
    assert.equal(plan.kind, 'APPROVAL');
    const erc = await abiInterface('abis/erc20.json');
    const decoded = erc.parseTransaction({ data: plan.transaction.inputData });
    assert.equal(decoded.args.spender, registry.dex.permit2);
    assert.equal(decoded.args.amount, 1000n * 10n ** 18n);
  });
});

test('unknown submissions without an order identifier recover only from an exact chain transaction match', async () => {
  await executionFixture({ unknownSubmission: true }, async f => {
    const preview = await f.execution.prepare(intent);
    await assert.rejects(f.execution.execute(preview.planId, { confirmed: true }));
    const plan = await f.store.load(preview.planId);
    f.state.history = [{ txHash: hash }];
    f.state.recoveryTransaction = { from: wallet, to: plan.transaction.to, value: '0x0', input: '0x1234', blockNumber: '0x100' };
    assert.equal((await f.execution.status(preview.planId)).status, 'UNKNOWN');
    f.state.recoveryTransaction.input = plan.transaction.inputData;
    const recovered = await f.execution.status(preview.planId);
    assert.equal(recovered.status, 'SUBMITTED');
    assert.equal(recovered.transactionHash, hash);
    assert.equal(f.walletTrace.filter(x => x[1] === 'execute').length, 1);
  });
});
