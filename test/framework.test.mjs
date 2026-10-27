import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertFrameworkConfig, summarizeCapabilities } from '../scripts/lib/config.mjs';
import { validateRepository } from '../scripts/lib/validate.mjs';

const root = new URL('../', import.meta.url);
const initial = JSON.parse(await readFile(new URL('config/bsc.json', root), 'utf8'));
const config = () => structuredClone(initial);

test('published capabilities enable TagAI and Flap while keeping missing platforms disabled', () => {
  const result = summarizeCapabilities(config());
  assert.equal(result.tradingEnabled, true);
  assert.equal(result.networkAccess, true);
  assert.equal(result.walletAccess, true);
  for (const [id, platform] of Object.entries(result.platforms)) {
    assert.equal(platform.status, ['tagai', 'flap'].includes(id) ? 'live' : 'not_integrated');
    for (const [key, value] of Object.entries(platform)) if (key !== 'status') assert.equal(value, ['tagai', 'flap'].includes(id));
  }
});

test('config edits cannot enable missing adapters or an alternate chain', () => {
  for (const mutate of [
    value => { value.chainId = 1; },
    value => { value.tradingEnabled = false; },
    value => { value.phase = 'production'; },
    value => { value.platforms.gang.capabilities.internalTrade = true; },
    value => { value.platforms.tagai.status = 'ready'; },
    value => { value.platforms.flap.capabilities.search = 'false'; },
  ]) {
    const value = config();
    mutate(value);
    assert.throws(() => assertFrameworkConfig(value));
    assert.throws(() => summarizeCapabilities(value));
  }
});

test('unverified deployments, foreign DEX and unsupported source types fail closed', () => {
  for (const mutate of [
    value => { value.multicall.address = '0x1111111111111111111111111111111111111111'; },
    value => { value.importedTokenSwapWrapper.address = '0x1111111111111111111111111111111111111111'; },
    value => { value.importedTokenSwapWrapper.sourceReferenceTypes.push(2); },
    value => { value.dex.allowedBrands.push('other'); },
    value => { value.dex.deployments.push({ brand: 'pancake' }); },
  ]) {
    const value = config();
    mutate(value);
    assert.throws(() => assertFrameworkConfig(value));
  }
});

test('missing platform evidence cannot disappear from capability coverage', () => {
  const value = config();
  delete value.platforms.fourme;
  assert.throws(() => assertFrameworkConfig(value));
  assert.throws(() => assertFrameworkConfig(null));
  assert.throws(() => assertFrameworkConfig({}));
});

test('CLI works outside the repository and refuses unimplemented trading commands', () => {
  const cli = fileURLToPath(new URL('scripts/trade.mjs', root));
  const status = spawnSync(process.execPath, [cli, 'capabilities'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).data.tradingEnabled, true);
  for (const args of [['buy'], ['swap'], ['capabilities', '--execute'], []]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(['INVALID_COMMAND', 'INVALID_ARGUMENT'].includes(JSON.parse(result.stderr).error.code));
    assert.equal(result.stdout, '');
  }
});

test('repository references and ABI provenance validate without any network', async () => {
  const result = await validateRepository(root);
  assert.equal(result.valid, true);
  assert.equal(result.liveTradingTested, false);
  assert.ok(result.abiFiles > 3);
});

test('changed ABI bytes and broken references are rejected', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'swap-skill-test-'));
  try {
    for (const name of ['SKILL.md', 'README.md', 'AGENTS.md', 'config', 'references', 'abis']) {
      await cp(fileURLToPath(new URL(name, root)), path.join(scratch, name), { recursive: true });
    }
    const scratchRoot = pathToFileURL(`${scratch}${path.sep}`);
    await validateRepository(scratchRoot);
    const abi = path.join(scratch, 'abis', 'erc20.json');
    const original = await readFile(abi, 'utf8');
    await writeFile(abi, `${original}\n`);
    await assert.rejects(validateRepository(scratchRoot), /provenance hash mismatch/);
    await writeFile(abi, original);
    await writeFile(path.join(scratch, 'references', 'broken.md'), '[missing](missing-file.md)\n');
    await assert.rejects(validateRepository(scratchRoot), /ENOENT|missing reference/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
