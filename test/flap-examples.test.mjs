import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AbiCoder, ZeroAddress } from 'ethers';
import { FlapLive, flapRegistry } from '../scripts/lib/flap-live.mjs';
import { abiInterface, tagaiRegistry } from '../scripts/lib/tagai.mjs';

const vectors = JSON.parse(await readFile(new URL('../config/flap-worked-examples.json', import.meta.url), 'utf8'));
const registry = flapRegistry(), dex = tagaiRegistry();
const sample = id => vectors.examples.find(row => row.id === id);
const same = (a, b) => assert.equal(a.toLowerCase(), b.toLowerCase());

test('all six Flap examples round-trip the actual runtime method, destination, amount, protected minimum and native value', async () => {
  for (const row of vectors.examples) {
    const abi = await abiInterface(row.abi), parsed = abi.parseTransaction({ data: row.transaction.inputData });
    assert.equal(parsed.signature, row.decoded.signature);
    const buy = row.intent.side === 'buy';
    const minimum = BigInt(row.quoteOutRaw) * 9900n / 10000n;
    assert.equal(minimum, BigInt(row.minimumOutRaw));
    const expectedTarget = row.kind === 'ordinary' ? registry.portal.address : row.kind === 'agent' ? registry.agentCurve.identities.portal.address : registry.wrapper.address;
    same(row.transaction.to, expectedTarget);
    assert.equal(row.transaction.valueWei, buy ? '1000000000000000' : '0');
    const info = { token: row.intent.token, phase: row.kind === 'external' ? 'external' : 'internal' };
    if (row.kind === 'agent') Object.assign(info, { agentCurve: true, market: row.intent.token });
    if (row.kind === 'external') info.sourceData = parsed.args[2];
    const deadline = row.kind === 'external' ? Number(parsed.args[buy ? 5 : 6]) : vectors.snapshot.timestamp + 180;
    const live = new FlapLive({ now: () => deadline - 180 });
    const encoded = await live.transaction({ info, side: row.intent.side, amountIn: BigInt(row.amountInRaw), minimum,
      shareBps: row.shareBps === null ? null : BigInt(row.shareBps), recipient: row.transaction.from, subject: ZeroAddress }, row.transaction.from);
    assert.equal(encoded.inputData, row.transaction.inputData);
    assert.equal(encoded.valueWei, row.transaction.valueWei);
    same(encoded.to, row.transaction.to);
    if (row.kind === 'ordinary') {
      const args = parsed.args[0];
      assert.equal(args.inputAmount, BigInt(row.amountInRaw));
      assert.equal(args.minOutputAmount, minimum);
      assert.equal(args.permitData, '0x');
      same(args.inputToken, buy ? ZeroAddress : row.intent.token);
      same(args.outputToken, buy ? row.intent.token : ZeroAddress);
    }
  }
});

test('ordinary Flap quote examples bind the full input tuple, Portal and fixed block to their returned outputs', async () => {
  const abi = await abiInterface('abis/flap/portal.json');
  for (const id of ['ordinary-buy-0.001', 'ordinary-sell-1000']) {
    const row = sample(id), read = row.reads.find(call => call.method === 'quoteExactInput');
    same(read.target, registry.portal.address);
    assert.equal(read.blockTag, vectors.snapshot.blockTag);
    const quote = abi.parseTransaction({ data: read.inputData }).args[0];
    const trade = abi.parseTransaction({ data: row.transaction.inputData }).args[0];
    assert.equal(quote.inputToken, trade.inputToken);
    assert.equal(quote.outputToken, trade.outputToken);
    assert.equal(quote.inputAmount, BigInt(row.amountInRaw));
    assert.equal(abi.decodeFunctionResult('quoteExactInput', read.returnData)[0], BigInt(row.quoteOutRaw));
    if (row.intent.side === 'buy') same(read.outerFrom, row.transaction.from);
  }
});

test('ID Agent examples quote the explicit wallet and protect the actual share percentage sale', async () => {
  const abi = await abiInterface('abis/flap/agent-curve.json');
  const buy = sample('agent-buy-0.001'), read = buy.reads.find(call => call.method === 'quoteBuy');
  same(read.target, registry.agentCurve.identities.portal.address);
  assert.equal(read.blockTag, vectors.snapshot.blockTag);
  const quoted = abi.parseTransaction({ data: read.inputData });
  same(quoted.args.market, buy.intent.token);
  same(quoted.args.wallet, buy.transaction.from);
  assert.equal(quoted.args.grossWei, BigInt(buy.amountInRaw));
  const result = abi.decodeFunctionResult('quoteBuy', read.returnData);
  assert.equal(result.acceptedGross + result.refund, BigInt(buy.amountInRaw));
  assert.equal(result.shares, BigInt(buy.quoteOutRaw));
  const sell = sample('agent-sell-50pct'), provisional = abi.parseTransaction({ data: sell.quoteSimulation.inputData });
  assert.equal(sell.quoteSimulation.blockTag, vectors.snapshot.blockTag);
  same(sell.quoteSimulation.from, sell.transaction.from);
  same(sell.quoteSimulation.to, registry.agentCurve.identities.portal.address);
  same(provisional.args.market, sell.intent.token);
  assert.equal(provisional.args.bps, 5000n);
  assert.equal(provisional.args.minOut, 1n);
  const protectedSale = abi.parseTransaction({ data: sell.transaction.inputData });
  assert.equal(protectedSale.args.bps, provisional.args.bps);
  assert.equal(protectedSale.args.minOut, BigInt(sell.minimumOutRaw));
  assert.ok(protectedSale.args.minOut > 1n);
  assert.notEqual(sell.transaction.inputData, sell.quoteSimulation.inputData);
  assert.equal(BigInt(sell.amountInRaw), BigInt(vectors.observations.agent.position.shares) * 5000n / 10000n);
});

test('external Flap examples bind sourceData to the actual Pancake pair and reproduce staged quote amounts', async () => {
  const wrapper = await abiInterface('abis/imported-token-swap-wrapper.json');
  const router = await abiInterface('abis/tagai/pancake.json');
  for (const id of ['external-buy-0.001', 'external-sell-1000']) {
    const row = sample(id), buy = row.intent.side === 'buy';
    const trade = wrapper.parseTransaction({ data: row.transaction.inputData });
    const [source] = AbiCoder.defaultAbiCoder().decode(['tuple(address router,address pair)'], trade.args[2]);
    assert.equal(trade.args[1], 0n);
    same(source.router, dex.dex.v2Router);
    same(source.pair, vectors.observations.external.pool.pair);
    same(trade.args[buy ? 4 : 5], row.transaction.from);
    assert.equal(trade.args[buy ? 3 : 4], BigInt(row.minimumOutRaw));
    for (const read of row.reads) assert.equal(read.blockTag, vectors.snapshot.blockTag);
    const dexRead = row.reads.find(read => read.method === 'getAmountsOut');
    same(dexRead.target, dex.dex.v2Router);
    const args = router.parseTransaction({ data: dexRead.inputData }).args;
    assert.deepEqual(Array.from(args[1]).map(address => address.toLowerCase()), (buy ? [dex.wrappedNative, row.intent.token] : [row.intent.token, dex.wrappedNative]).map(address => address.toLowerCase()));
    const tax = BigInt(row.reads.find(read => read.method === (buy ? 'buyTaxRate' : 'sellTaxRate')).result[0]);
    const inputRead = row.reads.find(read => read.method === (buy ? 'previewFees' : 'previewTokenFee') && read.args[buy ? 0 : 1] === row.amountInRaw);
    const available = BigInt(inputRead.result[0]);
    assert.equal(args[0], buy ? available : available - available * tax / 10000n);
    const poolOutput = router.decodeFunctionResult('getAmountsOut', dexRead.returnData)[0][1];
    const final = row.reads.at(-1);
    same(final.target, registry.wrapper.address);
    assert.equal(final.method, buy ? 'previewTokenFee' : 'previewFees');
    assert.equal(BigInt(final.args[buy ? 1 : 0]), buy ? poolOutput - poolOutput * tax / 10000n : poolOutput);
    assert.equal(BigInt(final.result[0]), BigInt(row.quoteOutRaw));
  }
});

test('four recorded complete-call simulations decode to the quoted outputs and satisfy the final protected minimum', async () => {
  const simulated = vectors.examples.filter(row => row.simulation);
  assert.equal(simulated.length, 4);
  for (const row of simulated) {
    const abi = await abiInterface(row.abi), call = abi.parseTransaction({ data: row.transaction.inputData });
    const actual = abi.decodeFunctionResult(call.fragment, row.simulation.returnData)[0];
    assert.equal(actual, BigInt(row.simulation.outputRaw));
    assert.equal(actual, BigInt(row.quoteOutRaw));
    assert.ok(actual >= BigInt(row.minimumOutRaw));
  }
});
