import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ZeroAddress } from 'ethers';
import { abiInterface, encodeTagai, tagaiRegistry } from '../scripts/lib/tagai.mjs';
import { TagaiLive } from '../scripts/lib/tagai-live.mjs';

const vectors = JSON.parse(await readFile(new URL('../config/tagai-worked-examples.json', import.meta.url), 'utf8'));
const R = tagaiRegistry();
const sample = id => vectors.examples.find(row => row.id === id);

test('the real TTAI ticker example stops on both exact case-insensitive matches', async () => {
  const rows = vectors.search.tagaiExactCandidates;
  const live = new TagaiLive({ fetcher: async url => {
    assert.match(url, /community\/search\?tick=TTAI$/);
    return { ok: true, json: async () => rows.map(row => ({ chainId: 56, tick: row.symbol, token: row.address, isImport: 0 })) };
  } });
  await assert.rejects(live.resolve('TTAI'), error => {
    assert.equal(error.code, 'TOKEN_AMBIGUOUS');
    assert.deepEqual(error.details.candidates.map(row => row.contractAddress), rows.map(row => row.address));
    return true;
  });
});

test('recorded TTAI buy/sell calldata round-trips the direct Router, path, full input and once-applied minimum', async () => {
  const dex = await abiInterface('abis/tagai/pancake.json');
  for (const id of ['ttai-buy-0.001', 'ttai-sell-1000']) {
    const row = sample(id), buy = row.intent.side === 'buy';
    const parsed = dex.parseTransaction({ data: row.transaction.inputData });
    const deadline = Number(parsed.args[buy ? 3 : 4]);
    const encoded = await encodeTagai({ chainId: 56, kind: 'v2', version: '1', side: row.intent.side, wallet: row.transaction.from,
      token: row.intent.token, amountIn: row.amountInRaw, quoteOut: row.quoteOutRaw, slippageBps: row.intent.slippageBps, deadline }, { now: deadline - 180 });
    assert.equal(encoded.transaction.inputData, row.transaction.inputData);
    assert.equal(encoded.transaction.to, R.dex.v2Router);
    assert.equal(encoded.transaction.valueWei, buy ? '1000000000000000' : '0');
    assert.equal(row.minimumOutRaw, (BigInt(row.quoteOutRaw) * 9900n / 10000n).toString());
    const path = Array.from(parsed.args[buy ? 1 : 2]);
    assert.deepEqual(path, buy ? [R.wrappedNative, row.intent.token] : [row.intent.token, R.wrappedNative]);
    assert.equal(parsed.selector, buy ? '0xb6f9de95' : '0x791ac947');
  }
});

test('the recorded TTAI reference price and amount quotes use their actual reserves and pool fee', () => {
  const row = sample('ttai-buy-0.001'), o = vectors.observations[row.intent.token], pool = o.pool;
  const tokenReserve = BigInt(pool.tokenReserve), nativeReserve = BigInt(pool.nativeReserve);
  assert.equal(nativeReserve * 10n ** 18n / tokenReserve, 67030883685n);
  const input = BigInt(row.amountInRaw), inputAfterFeeScaled = input * 9975n;
  assert.equal(inputAfterFeeScaled * tokenReserve / (nativeReserve * 10000n + inputAfterFeeScaled), BigInt(row.quoteOutRaw));
  const sale = sample('ttai-sell-1000'), saleScaled = BigInt(sale.amountInRaw) * 9975n;
  assert.equal(saleScaled * nativeReserve / (tokenReserve * 10000n + saleScaled), BigInt(sale.quoteOutRaw));
});

test('AIPRO internal vectors pass the net quote as expectation, apply slippage once and keep caller delivery', async () => {
  for (const id of ['aipro-buy-0.001', 'aipro-sell-1000']) {
    const row = sample(id), buy = row.intent.side === 'buy';
    const encoded = await encodeTagai({ chainId: 56, kind: 'internal', version: '15', side: row.intent.side, wallet: row.transaction.from,
      token: row.intent.token, amountIn: row.amountInRaw, quoteOut: row.quoteOutRaw, slippageBps: 100 });
    assert.equal(encoded.transaction.inputData, row.transaction.inputData);
    assert.equal(encoded.transaction.to.toLowerCase(), row.intent.token.toLowerCase());
    const abi = await abiInterface('abis/tagai/token-v15.json');
    const p = abi.parseTransaction({ data: row.transaction.inputData });
    assert.equal(p.args[buy ? 0 : 1], BigInt(row.quoteOutRaw));
    assert.equal(p.args[buy ? 1 : 2], ZeroAddress);
    assert.equal(p.args[buy ? 2 : 3], 100n);
    assert.equal(row.minimumOutRaw, (BigInt(row.quoteOutRaw) * 9900n / 10000n).toString());
    assert.equal(row.transaction.valueWei, buy ? '1000000000000000' : '0');
  }
});
