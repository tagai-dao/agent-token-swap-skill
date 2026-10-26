import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(filename));
    else if (entry.isFile()) files.push(filename);
  }
  return files;
}

const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };

export async function validateRepository(root) {
  const config = await loadConfig(root);
  const directory = fileURLToPath(root);
  const files = await filesUnder(directory);
  const skill = await readFile(new URL('SKILL.md', root), 'utf8');
  requireCheck(skill.startsWith('---\n'), 'SKILL.md requires YAML frontmatter');
  requireCheck(/^name: agent-token-swap-skill$/m.test(skill), 'unexpected skill name');
  requireCheck(/^description: .+$/m.test(skill), 'skill description missing');
  let checkedLinks = 0;
  for (const filename of files.filter(name => name.endsWith('.md'))) {
    const text = await readFile(filename, 'utf8');
    for (const match of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|#)/.test(target)) continue;
      const link = decodeURIComponent(target.split('#')[0]);
      const resolved = path.resolve(path.dirname(filename), link);
      const relative = path.relative(directory, resolved);
      requireCheck(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `link outside skill: ${target}`);
      requireCheck((await stat(resolved)).isFile(), `missing reference: ${filename}: ${target}`);
      checkedLinks++;
    }
  }
  const provenance = JSON.parse(await readFile(new URL('abis/provenance.json', root), 'utf8'));
  const abiFiles = files.filter(name => name.endsWith('.json') && path.basename(path.dirname(name)) === 'abis'
    && path.basename(name) !== 'provenance.json');
  requireCheck(provenance.deploymentVerified === false, 'framework must not claim deployed ABI verification');
  requireCheck(Object.keys(provenance.files).length === abiFiles.length, 'ABI provenance coverage mismatch');
  for (const filename of abiFiles) {
    const bytes = await readFile(filename);
    const abi = JSON.parse(bytes.toString('utf8'));
    requireCheck(Array.isArray(abi) && abi.length > 0, `empty / invalid ABI: ${filename}`);
    requireCheck(provenance.files[path.basename(filename)]?.sha256 === createHash('sha256').update(bytes).digest('hex'), `ABI provenance hash mismatch: ${filename}`);
  }
  const multicall = JSON.parse(await readFile(new URL(config.multicall.abi, root), 'utf8'));
  const aggregate = multicall.find(item => item.type === 'function' && item.name === 'aggregate3');
  requireCheck(aggregate?.stateMutability === 'payable', 'aggregate3 must retain its real mutability');
  requireCheck(aggregate.inputs[0].type === 'tuple[]'
    && aggregate.inputs[0].components.map(item => `${item.name}:${item.type}`).join(',') === 'target:address,allowFailure:bool,callData:bytes', 'invalid aggregate3 call tuple');
  requireCheck(aggregate.outputs[0].type === 'tuple[]'
    && aggregate.outputs[0].components.map(item => `${item.name}:${item.type}`).join(',') === 'success:bool,returnData:bytes', 'invalid aggregate3 result tuple');
  const wrapper = JSON.parse(await readFile(new URL(config.importedTokenSwapWrapper.abi, root), 'utf8'));
  for (const name of ['quoteBuy', 'quoteSell']) {
    requireCheck(wrapper.find(item => item.type === 'function' && item.name === name)?.stateMutability === 'nonpayable', `${name} must retain nonpayable source ABI`);
  }
  requireCheck(wrapper.find(item => item.type === 'function' && item.name === 'buyToken')?.stateMutability === 'payable', 'buyToken must be payable');
  requireCheck(wrapper.find(item => item.type === 'function' && item.name === 'sellToken')?.stateMutability === 'nonpayable', 'sellToken must be nonpayable');
  return { valid: true, phase: config.phase, platformCount: 4, abiFiles: abiFiles.length, checkedLinks, liveTradingTested: false };
}
