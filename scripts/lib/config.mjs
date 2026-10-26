import { readFile } from 'node:fs/promises';
import { tagaiRegistry } from './tagai.mjs';

export const PLATFORM_IDS = Object.freeze(['flap', 'fourme', 'tagai', 'gang']);
export const CAPABILITY_IDS = Object.freeze(['search', 'provenance', 'state', 'quote', 'internalTrade', 'externalTrade']);
const registry = tagaiRegistry();
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameSet = (actual, expected) => actual.length === expected.length && actual.every(value => expected.includes(value));
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const liveVersions = ['2', '3', '4', '9', '11', '13', '14', '15', '15-2', '16'];
const runtimeHash = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891';

export function validateConfig(config) {
  const errors = [];
  if (!isObject(config)) return ['config must be an object'];
  if (config.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (config.phase !== 'live' || config.tradingEnabled !== true) errors.push('the TagAI live command configuration is required');
  if (config.chainId !== 56) errors.push('only BSC chainId 56 is supported');
  if (config.nativeAsset?.symbol !== 'BNB' || config.nativeAsset?.decimals !== 18) errors.push('native asset must be BNB with 18 decimals');
  if (!same(config.wrappedNative, registry.wrappedNative)) errors.push('untrusted wrapped BNB address');
  if (config.multicall?.status !== 'verified' || !same(config.multicall?.address, registry.multicall)
      || config.multicall?.runtimeHash !== runtimeHash || config.multicall?.abi !== 'abis/multicall3.json') errors.push('verified BSC Multicall configuration is required');
  const wrapper = config.importedTokenSwapWrapper;
  if (!isObject(wrapper) || wrapper.status !== 'pending_verification' || wrapper.address !== null || wrapper.verification !== null
      || wrapper.abi !== 'abis/imported-token-swap-wrapper.json') errors.push('external-platform wrapper must remain disabled until its integration is implemented');
  if (!Array.isArray(wrapper?.sourceReferenceTypes) || !sameSet(wrapper.sourceReferenceTypes, [0, 1, 3])) errors.push('wrapper source reference types must be exactly 0, 1, 3');
  if (!Array.isArray(config.dex?.allowedBrands) || !sameSet(config.dex.allowedBrands, ['uniswap', 'pancake'])) errors.push('only uniswap and pancake DEX brands may be allowed');
  if (!Array.isArray(config.dex?.deployments) || config.dex.deployments.length !== 2) errors.push('only the implemented TagAI DEX deployments may be configured');
  else for (const entry of config.dex.deployments) {
    if (entry.brand !== 'pancake' || !['v2', 'infinity-cl'].includes(entry.protocol)) errors.push('unsupported DEX deployment');
    if (entry.protocol === 'v2' && (!same(entry.router, registry.dex.v2Router) || !same(entry.factory, registry.dex.v2Factory))) errors.push('untrusted V2 deployment');
    if (entry.protocol === 'infinity-cl' && (!same(entry.router, registry.dex.universalRouter) || !same(entry.manager, registry.dex.clPoolManager) || !same(entry.quoter, registry.dex.clQuoter))) errors.push('untrusted Infinity deployment');
  }
  if (!isObject(config.platforms) || !sameSet(Object.keys(config.platforms), PLATFORM_IDS)) errors.push('platform registry must contain flap, fourme, tagai, gang exactly');
  for (const id of PLATFORM_IDS) {
    const platform = config.platforms?.[id];
    if (!isObject(platform)) { errors.push(`${id}: platform entry missing`); continue; }
    const live = id === 'tagai';
    if (platform.status !== (live ? 'live' : 'not_integrated')) errors.push(`${id}: status does not match implemented adapters`);
    if (platform.reference !== `references/platforms/${id}.md`) errors.push(`${id}: invalid platform reference`);
    if (!Array.isArray(platform.versions) || !sameSet(platform.versions, live ? liveVersions : [])) errors.push(`${id}: invalid live version coverage`);
    if (!isObject(platform.capabilities) || !sameSet(Object.keys(platform.capabilities), CAPABILITY_IDS)) errors.push(`${id}: exact capability set is required`);
    for (const capability of CAPABILITY_IDS) if (platform.capabilities?.[capability] !== live) errors.push(`${id}.${capability}: capability does not match its adapter`);
  }
  return errors;
}

export function assertFrameworkConfig(config) {
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join('; '));
  return config;
}
export async function loadConfig(root) { return assertFrameworkConfig(JSON.parse(await readFile(new URL('config/bsc.json', root), 'utf8'))); }
export function summarizeCapabilities(config) {
  assertFrameworkConfig(config);
  return { phase: config.phase, chainId: config.chainId, tradingEnabled: true, networkAccess: true, walletAccess: true,
    commands: ['capabilities', 'validate', 'info', 'quote', 'prepare', 'execute', 'status'],
    confirmationRequiredBeforeExecute: true, allowedDexBrands: config.dex.allowedBrands, configuredDexDeployments: config.dex.deployments.length,
    platforms: Object.fromEntries(PLATFORM_IDS.map(id => [id, { status: config.platforms[id].status, ...config.platforms[id].capabilities }])) };
}
