import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, Interface, ZeroAddress } from 'ethers';
import { readFile } from 'node:fs/promises';
import { encodeTagai, buildReadPlan, decodeReadResult, tagaiRegistry } from '../scripts/lib/tagai.mjs';

const registry = tagaiRegistry();
const wallet = '0x2222222222222222222222222222222222222222';
const token = '0x1111111111111111111111111111111111111111';
const subject = '0x3333333333333333333333333333333333333333';
const now = 1800000000;
const options = { now };
const request = (extra = {}) => ({ chainId: 56, kind: 'internal', version: '16', side: 'buy', wallet, token, amountIn: '1000000000000000', quoteOut: '1000000000000000000', slippageBps: 100, ...extra });
const abi = async filename => new Interface(JSON.parse(await readFile(new URL(`../abis/${filename}`, import.meta.url), 'utf8')));

test('V5 and V8 cannot encode either internal or external trades, even with signatures', async () => {
  for (const version of ['5', '8']) for (const kind of ['internal', 'v2', 'infinity']) for (const side of ['buy', 'sell']) {
    await assert.rejects(encodeTagai(request({ version, kind, side, signature: '0x1234', gateDisabled: true }), options), /V5 and V8 are excluded/);
  }
});

test('supported internal versions select their own ABI and preserve caller/value/argument semantics', async () => {
  for (const v of registry.versions.filter(v => v.supported)) {
    for (const side of ['buy', 'sell']) {
      const result = await encodeTagai(request({ version: v.id, side }), options);
      const iface = await abi(v.tokenAbi.slice(5));
      const parsed = iface.parseTransaction({ data: result.transaction.inputData });
      assert.equal(parsed.name, side === 'buy' ? 'buyToken' : 'sellToken');
      assert.equal(parsed.args.length, side === 'sell' || v.id === '1' ? 4 : 3);
      assert.equal(result.transaction.to.toLowerCase(), token);
      assert.equal(result.transaction.from.toLowerCase(), wallet);
      assert.equal(result.transaction.valueWei, side === 'buy' ? '1000000000000000' : '0');
      assert.equal(result.preparationOnly, true);
      assert.equal(result.readyToSend, false);
      if (side === 'buy' && v.id === '1') assert.equal(parsed.args[3], ZeroAddress);
      if (v.requiresBuyerHandle && side === 'buy') assert.ok(result.requires.includes('nonempty on-chain handleOf(wallet)'));
    }
  }
});

test('minimum output is applied once; zero slippage never disables the contract guard', async () => {
  const ordinary = await encodeTagai(request(), options);
  assert.equal(ordinary.expectedArgument, '1000000000000000000');
  assert.equal(ordinary.minimumOut, '990000000000000000');
  const exact = await encodeTagai(request({ slippageBps: 0 }), options);
  assert.equal(exact.contractSlippageBps, 1);
  assert.equal(exact.minimumOut, '1000000000000000000');
  assert.ok(BigInt(exact.expectedArgument) * 9999n / 10000n >= BigInt(exact.minimumOut));
});

test('legacy V2 uses direct Router02 without wrapper pre-deductions', async () => {
  const iface = await abi('tagai/pancake.json');
  const buy = await encodeTagai(request({ version: '4', kind: 'v2', deadline: now + 120 }), options);
  const parsed = iface.parseTransaction({ data: buy.transaction.inputData });
  assert.equal(parsed.name, 'swapExactETHForTokensSupportingFeeOnTransferTokens');
  assert.equal(buy.transaction.to, registry.dex.v2Router);
  assert.equal(buy.transaction.valueWei, '1000000000000000');
  assert.deepEqual(Array.from(parsed.args.path).map(x => x.toLowerCase()), [registry.wrappedNative.toLowerCase(), token]);
  const sell = await encodeTagai(request({ version: '4', kind: 'v2', side: 'sell', deadline: now + 120 }), options);
  assert.equal(iface.parseTransaction({ data: sell.transaction.inputData }).name, 'swapExactTokensForETHSupportingFeeOnTransferTokens');
  assert.equal(sell.transaction.valueWei, '0');
});

const poolKey = () => ({ currency0: ZeroAddress, currency1: token, hooks: registry.versions.find(v => v.id === '16').hook, poolManager: registry.dex.clPoolManager, fee: 0, parameters: `0x${'00'.repeat(32)}` });

test('Infinity payload has exact command/actions, nested PoolKey, direction, settlement and minimum output', async () => {
  const iface = await abi('tagai/pancake.json');
  const coder = AbiCoder.defaultAbiCoder();
  for (const side of ['buy', 'sell']) {
    const result = await encodeTagai(request({ kind: 'infinity', side, subject, poolKey: poolKey(), deadline: now + 120 }), options);
    assert.equal(result.transaction.to, registry.dex.universalRouter);
    const parsed = iface.parseTransaction({ data: result.transaction.inputData });
    assert.equal(parsed.args.commands, '0x10');
    const [actions, params] = coder.decode(['bytes', 'bytes[]'], parsed.args.inputs[0]);
    assert.equal(actions, '0x060c0f');
    assert.equal(params.length, 3);
    const [swap] = coder.decode(['tuple(tuple(address,address,address,address,uint24,bytes32),bool,uint128,uint128,bytes)'], params[0]);
    assert.equal(swap[1], side === 'buy');
    assert.equal(swap[2], 1000000000000000n);
    assert.equal(swap[3], 990000000000000000n);
    assert.equal(swap[4], coder.encode(['address'], [subject]));
    const [settleCurrency, maxInput] = coder.decode(['address', 'uint128'], params[1]);
    const [takeCurrency, minimum] = coder.decode(['address', 'uint128'], params[2]);
    assert.equal(settleCurrency.toLowerCase(), side === 'buy' ? ZeroAddress : token);
    assert.equal(takeCurrency.toLowerCase(), side === 'buy' ? token : ZeroAddress);
    assert.equal(maxInput, 1000000000000000n);
    assert.equal(minimum, swap[3]);
    assert.equal(result.transaction.valueWei, side === 'buy' ? '1000000000000000' : '0');
  }
});

test('approval chain uses finite ERC20-to-Permit2 and Permit2-to-Router authority', async () => {
  const erc20 = await abi('erc20.json');
  const approval = await encodeTagai(request({ kind: 'erc20-approval', spender: registry.dex.permit2 }), options);
  const first = erc20.parseTransaction({ data: approval.transaction.inputData });
  assert.equal(first.args.spender, registry.dex.permit2);
  assert.equal(first.args.amount, 1000000000000000n);
  const reset = await encodeTagai(request({ kind: 'erc20-approval', spender: registry.dex.permit2, amountIn: '0' }), options);
  assert.equal(erc20.parseTransaction({ data: reset.transaction.inputData }).args.amount, 0n);
  const permit2 = await encodeTagai(request({ kind: 'permit2-approval', expiration: now + 300 }), options);
  const parsed = (await abi('tagai/pancake.json')).parseTransaction({ data: permit2.transaction.inputData });
  assert.equal(permit2.transaction.to, registry.dex.permit2);
  assert.equal(parsed.args.spender, registry.dex.universalRouter);
  assert.equal(parsed.args.amount, 1000000000000000n);
  assert.equal(parsed.args.expiration, BigInt(now + 300));
});

test('unsupported chains/versions, unsafe inputs, stale deadlines and untrusted pools are rejected', async () => {
  for (const change of [
    { chainId: 1 }, { version: '6' }, { version: '10' }, { version: '17' },
    { amountIn: 0.1 }, { amountIn: '0' }, { slippageBps: 10000 }, { quoteOut: '1', slippageBps: 9999 },
    { recipient: subject }, { kind: 'v2', deadline: now - 1 },
    { kind: 'infinity', deadline: now + 60, poolKey: { ...poolKey(), poolManager: subject } },
    { kind: 'infinity', deadline: now + 60, poolKey: { ...poolKey(), currency0: registry.wrappedNative } },
    { kind: 'infinity', deadline: now + 60, poolKey: { ...poolKey(), hooks: subject } },
  ]) await assert.rejects(encodeTagai(request(change), options));
});

test('issuance batch targets Multicall with the complete ordered proof set at a pinned block', async () => {
  const plan = await buildReadPlan({ chainId: 56, stage: 'issuance', token, blockTag: '0x123456' });
  assert.equal(plan.rpc.method, 'eth_call');
  assert.equal(plan.rpc.params[0].to, registry.multicall);
  assert.equal(plan.rpc.params[1], '0x123456');
  const multi = await abi('multicall3.json');
  const calls = multi.decodeFunctionData('aggregate3', plan.rpc.params[0].data)[0];
  const expected = registry.versions.filter(v => v.issuanceGetterDocumented && v.marketFamily !== 'import');
  assert.deepEqual(Array.from(calls).map(x => x.target.toLowerCase()), expected.map(v => v.pump.toLowerCase()));
  const proof = await abi('tagai/read-interfaces.json');
  for (const call of calls) {
    assert.equal(call.allowFailure, true);
    assert.equal(proof.decodeFunctionData('createdTokens', call.callData)[0].toLowerCase(), token);
  }
  assert.ok(plan.coverage.incompleteLegacyProofs.includes('8'));
  assert.ok(expected.some(v => v.id === '5')); // Detection can stop an excluded token.
  assert.deepEqual((await buildReadPlan({ chainId: 56, stage: 'issuance', token, blockTag: '0x123456' })).rpc, plan.rpc);
});

test('dependent read chunks preserve blockTag and never produce individual RPC calls', async () => {
  const specs = [
    { label: 'listed', target: token, abi: 'abis/tagai/token-v16.json', method: 'listed', args: [], required: true },
    { label: 'pending', target: token, abi: 'abis/tagai/token-v16.json', method: 'listingPending', args: [], required: true },
  ];
  for (const calls of [specs, ...specs.map(spec => [spec])]) {
    const plan = await buildReadPlan({ chainId: 56, blockTag: '0x123456', calls });
    assert.equal(plan.rpc.params[0].to, registry.multicall);
    assert.equal(plan.rpc.params[1], '0x123456');
  }
  await assert.rejects(buildReadPlan({ chainId: 56, blockTag: 'latest', calls: specs }), /numeric hexadecimal/);
  await assert.rejects(buildReadPlan({ chainId: 56, blockTag: '0x123456', calls: [{ ...specs[0], method: 'buyToken', args: ['1', ZeroAddress, 1] }] }), /cannot include trading/);
  await assert.rejects(buildReadPlan({ chainId: 56, blockTag: '0x123456', calls: [{ ...specs[0], abi: '../../.env' }] }), /registered package/);
});

test('required Multicall failures reject the result; optional failures remain UNKNOWN', async () => {
  const multi = await abi('multicall3.json');
  const tokenAbi = await abi('tagai/token-v16.json');
  const plan = await buildReadPlan({ chainId: 56, blockTag: '0x123456', calls: [
    { label: 'listed', target: token, abi: 'abis/tagai/token-v16.json', method: 'listed', args: [], required: true },
    { label: 'name', target: token, abi: 'abis/erc20.json', method: 'name', args: [], required: false },
  ] });
  const success = multi.encodeFunctionResult('aggregate3', [[[true, tokenAbi.encodeFunctionResult('listed', [false])], [false, '0x']]]);
  const decoded = await decodeReadResult(plan, success);
  assert.deepEqual(decoded.results[0].values, [false]);
  assert.equal(decoded.results[1].status, 'UNKNOWN');
  const failure = multi.encodeFunctionResult('aggregate3', [[[false, '0x'], [false, '0x']]]);
  await assert.rejects(decodeReadResult(plan, failure), /Required subcall/);
  await assert.rejects(decodeReadResult(plan, multi.encodeFunctionResult('aggregate3', [[]])), /length mismatch/);
  await assert.rejects(decodeReadResult({ ...plan, rpc: { ...plan.rpc, params: [{ ...plan.rpc.params[0], to: token }, '0x123456'] } }, success), /payload was altered/);
});
