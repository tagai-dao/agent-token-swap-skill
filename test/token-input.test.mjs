import test from 'node:test';
import assert from 'node:assert/strict';
import { getAddress } from 'ethers';
import { normalizeTokenInput } from '../scripts/lib/token-input.mjs';
import { PlatformLive } from '../scripts/lib/platform-live.mjs';
import { FlapLive } from '../scripts/lib/flap-live.mjs';
import { TagaiLive } from '../scripts/lib/tagai-live.mjs';

const address = '0xeac597ba087f6219c03a65479b2568d3f9a07777';
const url = `https://flap.sh/bnb/${address}?lang=zh`;

test('Flap links resolve from their path address, independently of language, query and fragment', () => {
  for (const input of [url, ` ${url} `, `https://www.flap.sh/bnb/${address}/`, `${url}&token=0x1111111111111111111111111111111111111111#other`]) {
    assert.equal(normalizeTokenInput(input), getAddress(address));
  }
  assert.equal(normalizeTokenInput(' AIPRO '), 'AIPRO');
  assert.equal(normalizeTokenInput(address), address);
});

test('all live resolvers accept the reported Flap link without HTTP search or registry ticker scans', async () => {
  const noFetch = async () => { assert.fail('An explicit token link must not use ticker search'); };
  const noRpc = async () => { assert.fail('Address normalization must not require RPC'); };
  const reader = { rpc: noRpc, snapshot: noRpc, batch: noRpc };
  for (const live of [new PlatformLive({ reader, fetcher: noFetch }), new FlapLive({ reader, fetcher: noFetch }), new TagaiLive({ reader, fetcher: noFetch })]) {
    const resolved = await live.resolve(url);
    assert.equal(resolved?.address ?? resolved, getAddress(address));
  }
});

test('unsupported chains, invalid addresses and unrelated URL hosts stop before ticker search', async () => {
  const cases = [
    [`https://flap.sh/eth/${address}`, 'WRONG_CHAIN'],
    [`https://flap.sh/bnb/0x1234`, 'INVALID_TOKEN_ADDRESS'],
    ['https://flap.sh/bnb/0xEac597Ba087f6219C03a65479B2568d3f9A07777', 'INVALID_TOKEN_ADDRESS'],
    [`https://flap.sh.evil.example/bnb/${address}`, 'INVALID_TOKEN_URL'],
    [`https://user@flap.sh/bnb/${address}`, 'INVALID_TOKEN_URL'],
    [`http://flap.sh/bnb/${address}`, 'INVALID_TOKEN_URL'],
    [`https://flap.sh/bnb/${address}/extra`, 'INVALID_TOKEN_URL'],
  ];
  const live = new PlatformLive({ fetcher: async () => assert.fail('Invalid links must not enter ticker search') });
  for (const [input, code] of cases) await assert.rejects(live.resolve(input), error => error.code === code);
});
