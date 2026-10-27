import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keccak256 } from 'ethers';
import { PlatformLive } from '../scripts/lib/platform-live.mjs';
import { ChainReader } from '../scripts/lib/live-rpc.mjs';
import { flapRegistry } from '../scripts/lib/flap-live.mjs';
import { abiInterface, tagaiRegistry } from '../scripts/lib/tagai.mjs';

const observation = JSON.parse(await readFile(new URL('../config/flap-aipro-query.json', import.meta.url), 'utf8'));

test('the reported Flap URL queries its actual AIPRO address through exact pinned Multicalls and preserves SPCXB price units', async () => {
  const snapshot = observation.snapshot, pending = [...observation.requests], trace = [];
  const registry = flapRegistry(), multicall = tagaiRegistry().multicall;
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return '0x38';
    if (method === 'eth_getBlockByNumber') {
      assert.ok(params[0] === 'latest' || params[0] === snapshot.blockTag);
      return { number: snapshot.blockTag, hash: snapshot.blockHash, timestamp: `0x${snapshot.timestamp.toString(16)}` };
    }
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_getStorageAt') {
      assert.equal(params[0], registry.portal.address);
      assert.equal(params[2], snapshot.blockTag);
      return `0x${registry.portal.implementation.slice(2).padStart(64, '0')}`;
    }
    assert.equal(method, 'eth_call');
    const next = pending.shift();
    assert.ok(next, 'Unexpected contract read');
    assert.equal(params[0].to, multicall);
    assert.equal(params[1], snapshot.blockTag);
    assert.deepEqual(params, next.params);
    trace.push(params);
    return next.result;
  };
  const reader = new ChainReader(rpc, { now: () => snapshot.timestamp, multicallRuntimeHash: keccak256('0x6000') });
  const live = new PlatformLive({ reader, fetcher: async () => assert.fail('An address link must not use ticker HTTP search'), now: () => snapshot.timestamp });
  live.adapters.flap.registry.portal.runtimeHash = keccak256('0x6000');
  live.adapters.flap.registry.portal.implementationRuntimeHash = keccak256('0x6000');
  const info = await live.inspect(observation.sourceUrl);
  assert.equal(pending.length, 0);
  assert.deepEqual(info.summary, observation.summary);
  assert.equal(info.token, observation.inputAddress);
  assert.equal(info.summary.platform, 'Flap');
  assert.equal(info.summary.referencePrice.currency, 'SPCXB');
  assert.deepEqual(info.quoteAsset, observation.quoteAsset);
  const multi = await abiInterface('abis/multicall3.json');
  for (let index = 0; index < trace.length; index++) {
    const actual = multi.decodeFunctionData('aggregate3', trace[index][0].data)[0];
    const expected = observation.requests[index].calls;
    assert.equal(actual.length, expected.length);
    for (let child = 0; child < actual.length; child++) {
      const abi = await abiInterface(expected[child].abi);
      assert.equal(actual[child].target, expected[child].target);
      assert.equal(actual[child].callData, abi.encodeFunctionData(expected[child].method, expected[child].args));
    }
  }
});
