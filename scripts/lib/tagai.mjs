import { readFile } from 'node:fs/promises';
import { AbiCoder, Interface, ZeroAddress, getAddress, isHexString, keccak256 } from 'ethers';

const root = new URL('../../', import.meta.url);
const coder = AbiCoder.defaultAbiCoder();
const registry = JSON.parse(await readFile(new URL('config/tagai-bsc.json', root), 'utf8'));
const provenance = JSON.parse(await readFile(new URL('abis/provenance.json', root), 'utf8'));
const multicall = new Interface(JSON.parse(await readFile(new URL('abis/multicall3.json', root), 'utf8')));
const poolTuple = 'tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters)';
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const check = (value, message) => { if (!value) throw new Error(message); };
const address = value => getAddress(value);
const raw = (value, name, bits = 256, allowZero = false) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), `${name} must be a decimal base-unit string`);
  const n = BigInt(value);
  check((allowZero ? n >= 0n : n > 0n) && n < (1n << BigInt(bits)), `${name} is outside uint${bits} bounds`);
  return n;
};
const integer = (value, name, max) => {
  check(Number.isSafeInteger(value) && value >= 0 && value <= max, `${name} is out of bounds`);
  return value;
};

export const tagaiRegistry = () => structuredClone(registry);

export async function abiInterface(id) {
  check(id?.startsWith('abis/') && Object.hasOwn(provenance.files, id.slice(5)), 'ABI must be a registered package file');
  return new Interface(JSON.parse(await readFile(new URL(id, root), 'utf8')));
}

function version(id) {
  check(!['5', '8'].includes(String(id)), 'V5 and V8 are excluded by user instruction');
  const found = registry.versions.find(value => value.id === String(id));
  check(found && found.supported === true && found.marketFamily !== 'import', 'Unsupported or imported TagAI version; V5 and V8 are excluded');
  return found;
}

export function minimumOutput(quoteOut, slippageBps) {
  const quote = raw(quoteOut, 'quoteOut');
  integer(slippageBps, 'slippageBps', 9999);
  const minimum = quote * BigInt(10000 - slippageBps) / 10000n;
  check(minimum > 0n, 'Minimum output rounds to zero');
  return minimum;
}

function deadline(value, now, name = 'deadline') {
  check(Number.isSafeInteger(value) && value > now, `${name} must be a future Unix-second integer`);
  return value;
}

function encoded(abi, method, args, to, wallet, value) {
  const data = abi.encodeFunctionData(method, args);
  const parsed = abi.parseTransaction({ data, value });
  return {
    binanceChainId: '56', from: wallet, to: address(to), valueWei: value.toString(), inputData: data,
    decoded: { signature: parsed.signature, selector: parsed.selector, args: Array.from(parsed.args) },
  };
}

export async function encodeTagai(request, { now = Math.floor(Date.now() / 1000) } = {}) {
  check(request?.chainId === 56, 'Only chainId 56 is supported');
  const wallet = address(request.wallet);
  const token = address(request.token);
  check(!same(token, ZeroAddress), 'Token cannot be the native zero address');
  const subject = address(request.subject ?? ZeroAddress);
  const recipient = address(request.recipient ?? wallet);
  if (request.version !== undefined) version(request.version);
  const amount = raw(request.amountIn, 'amountIn', 256, request.kind === 'erc20-approval');
  const out = {
    preparationOnly: true, readyToSend: false, networkAccess: false, walletAccess: false,
    requires: ['verified issuance/version and deployment', 'fresh fixed-block state and amount-specific quote', 'real-wallet simulation', 'successful wallet preview and user confirmation'],
  };
  if (request.kind === 'erc20-approval') {
    const spender = address(request.spender);
    check([registry.dex.v2Router, registry.dex.permit2].some(a => same(a, spender)), 'Unsupported TagAI approval spender');
    const abi = await abiInterface('abis/erc20.json');
    return { ...out, transaction: encoded(abi, 'approve', [spender, amount], token, wallet, 0n) };
  }
  if (request.kind === 'permit2-approval') {
    check(amount < (1n << 160n), 'Permit2 amount exceeds uint160');
    const expiration = deadline(request.expiration, now, 'expiration');
    check(BigInt(expiration) < (1n << 48n), 'Permit2 expiration exceeds uint48');
    const abi = await abiInterface('abis/tagai/pancake.json');
    return { ...out, transaction: encoded(abi, 'approve', [token, registry.dex.universalRouter, amount, expiration], registry.dex.permit2, wallet, 0n) };
  }
  const v = version(request.version);
  check(['buy', 'sell'].includes(request.side), 'side must be buy or sell');
  const buy = request.side === 'buy';
  const minimum = minimumOutput(request.quoteOut, request.slippageBps);
  out.minimumOut = minimum.toString();
  if (request.kind === 'internal') {
    check(same(recipient, wallet), 'Internal trades deliver to the caller; custom recipient is unsupported');
    const abi = await abiInterface(v.tokenAbi);
    // These contracts skip their slippage check at zero. Preserve a zero-tolerance
    // minimum by using a positive contract guard and an adjusted expectation.
    const slip = request.slippageBps || 1;
    const expected = request.slippageBps ? BigInt(request.quoteOut) : (minimum * 10000n + 9998n) / 9999n;
    check(expected <= ((1n << 256n) - 1n) / 10000n, 'Expectation may overflow contract slippage arithmetic');
    const args = buy ? [expected, subject, slip] : [amount, expected, subject, slip];
    const mode = buy ? v.internalBuy : v.internalSell;
    if (mode === 'receiver') args.push(ZeroAddress);
    out.contractSlippageBps = slip;
    out.expectedArgument = expected.toString();
    if (v.requiresBuyerHandle && buy) out.requires.push('nonempty on-chain handleOf(wallet)');
    out.transaction = encoded(abi, buy ? 'buyToken' : 'sellToken', args, token, wallet, buy ? amount : 0n);
    return out;
  }
  const expiry = deadline(request.deadline, now);
  const dex = await abiInterface('abis/tagai/pancake.json');
  if (request.kind === 'v2') {
    check(v.marketFamily === 'v2', 'This version does not use the legacy native-token V2 route');
    const route = buy ? [registry.wrappedNative, token] : [token, registry.wrappedNative];
    const method = buy ? 'swapExactETHForTokensSupportingFeeOnTransferTokens' : 'swapExactTokensForETHSupportingFeeOnTransferTokens';
    const args = buy ? [minimum, route, recipient, expiry] : [amount, minimum, route, recipient, expiry];
    out.transaction = encoded(dex, method, args, registry.dex.v2Router, wallet, buy ? amount : 0n);
    out.requires.push('official Factory pair matches quoted pair; actual tax-adjusted output simulation');
    return out;
  }
  check(request.kind === 'infinity' && v.marketFamily === 'infinity-cl', 'Unsupported route kind for this version');
  check(same(recipient, wallet), 'TAKE_ALL delivers to the router caller; custom recipient is unsupported');
  const key = request.poolKey;
  check(key && same(address(key.currency0), ZeroAddress) && same(address(key.currency1), token), 'Only direct native-BNB/token CL pools are supported');
  check(same(address(key.poolManager), registry.dex.clPoolManager), 'Untrusted CLPoolManager');
  address(key.hooks);
  check(!same(key.hooks, ZeroAddress), 'TagAI listing Hook cannot be zero');
  if (v.hook) check(same(key.hooks, v.hook), 'Hook differs from source registry; verify and update deployment evidence first');
  integer(key.fee, 'fee', 0xffffff);
  check(isHexString(key.parameters, 32), 'parameters must be bytes32');
  check(amount < (1n << 127n) && minimum < (1n << 128n), 'Infinity amount exceeds supported int128 / uint128 bounds');
  const hookData = same(subject, ZeroAddress) ? '0x' : coder.encode(['address'], [subject]);
  const swapTuple = `tuple(${poolTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`;
  const swap = coder.encode([swapTuple], [[key, buy, amount, minimum, hookData]]);
  const currencyIn = buy ? ZeroAddress : token;
  const currencyOut = buy ? token : ZeroAddress;
  const params = [swap, coder.encode(['address', 'uint128'], [currencyIn, amount]), coder.encode(['address', 'uint128'], [currencyOut, minimum])];
  const payload = coder.encode(['bytes', 'bytes[]'], ['0x060c0f', params]);
  out.poolId = keccak256(coder.encode([poolTuple], [key]));
  out.hookData = hookData;
  out.commands = '0x10';
  out.actions = '0x060c0f';
  out.transaction = encoded(dex, 'execute', ['0x10', [payload], expiry], registry.dex.universalRouter, wallet, buy ? amount : 0n);
  out.requires.push('token-bound listing PoolKey and poolId; official manager/vault; compatible Hook-inclusive Quoter');
  if (!buy) out.requires.push('finite ERC20 allowance to Permit2 and unexpired Permit2 allowance to Universal Router');
  return out;
}

export async function buildReadPlan(request) {
  check(request?.chainId === 56, 'Only chainId 56 is supported');
  check(typeof request.blockTag === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(request.blockTag), 'Pin a numeric hexadecimal blockTag; latest/pending are prohibited');
  let specs = request.calls;
  if (request.stage === 'issuance') {
    const token = address(request.token);
    specs = registry.versions.filter(v => v.issuanceGetterDocumented && v.marketFamily !== 'import').map(v => ({
      label: `issuer:${v.id}`, abi: 'abis/tagai/read-interfaces.json', target: v.pump,
      method: 'createdTokens', args: [token], required: false,
    }));
  }
  check(Array.isArray(specs) && specs.length > 0 && specs.length <= 100, 'Provide 1..100 calls; split larger requests into Multicalls at the same block');
  const labels = new Set();
  const calls = [];
  for (const spec of specs) {
    check(typeof spec.label === 'string' && spec.label.length > 0 && !labels.has(spec.label), 'Call labels must be nonempty and unique');
    labels.add(spec.label);
    const abi = await abiInterface(spec.abi);
    const method = abi.getFunction(spec.method);
    const targetRelease = registry.versions.find(v => same(v.pump, spec.target));
    check(!targetRelease || targetRelease.supported || method?.name === 'createdTokens', 'Excluded versions permit issuance detection only');
    check(method && (['view', 'pure'].includes(method.stateMutability) || ['quoteBuy', 'quoteSell', 'quoteExactInputSingle'].includes(method.name)), 'Read plans cannot include trading or approval methods');
    check(typeof spec.required === 'boolean', 'Each call requires an explicit required flag');
    calls.push({ target: address(spec.target), allowFailure: true, callData: abi.encodeFunctionData(method, spec.args ?? []) });
  }
  return {
    preparationOnly: true, deploymentVerified: false, chainId: 56, blockTag: request.blockTag,
    coverage: request.stage === 'issuance' ? { includedVersions: registry.versions.filter(v => v.issuanceGetterDocumented && v.marketFamily !== 'import').map(v => v.id), incompleteLegacyProofs: ['1', '7', '8'], excludedImports: ['6', '10'] } : null,
    calls: specs,
    rpc: { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: registry.multicall, data: multicall.encodeFunctionData('aggregate3', [calls]) }, request.blockTag] },
  };
}

export async function decodeReadResult(plan, result) {
  const expected = await buildReadPlan({ chainId: plan.chainId, blockTag: plan.blockTag, calls: plan.calls });
  check(JSON.stringify(expected.rpc) === JSON.stringify(plan.rpc), 'Read plan RPC payload was altered');
  const rows = multicall.decodeFunctionResult('aggregate3', result)[0];
  check(rows.length === plan.calls.length, 'Multicall result length mismatch');
  const output = [];
  for (let i = 0; i < rows.length; i++) {
    const spec = plan.calls[i];
    let values;
    try {
      check(rows[i].success, 'Subcall failed');
      values = Array.from((await abiInterface(spec.abi)).decodeFunctionResult(spec.method, rows[i].returnData));
    } catch {
      check(!spec.required, `Required subcall failed or could not decode: ${spec.label}`);
      output.push({ label: spec.label, status: 'UNKNOWN', values: null });
      continue;
    }
    output.push({ label: spec.label, status: 'SUCCESS', values });
  }
  return { blockTag: plan.blockTag, results: output };
}
