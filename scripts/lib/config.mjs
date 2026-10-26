import { readFile } from 'node:fs/promises';

export const PLATFORM_IDS = Object.freeze(['flap', 'fourme', 'tagai', 'gang']);
export const CAPABILITY_IDS = Object.freeze([
  'search', 'provenance', 'state', 'quote', 'internalTrade', 'externalTrade',
]);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameSet = (actual, expected) => actual.length === expected.length
  && actual.every(value => expected.includes(value));

// TagAI has offline preparation tools, but no bundled live adapters. Config edits
// alone must never enable live execution capabilities.
export function validateConfig(config) {
  const errors = [];
  if (!isObject(config)) return ['config must be an object'];
  if (config.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (config.phase !== 'framework') errors.push('this release only supports framework phase');
  if (config.chainId !== 56) errors.push('only BSC chainId 56 is supported');
  if (config.tradingEnabled !== false) errors.push('trading must remain disabled until adapters are implemented');
  if (config.nativeAsset?.symbol !== 'BNB' || config.nativeAsset?.decimals !== 18) {
    errors.push('native asset must be BNB with 18 decimals');
  }
  if (config.wrappedNative !== null) errors.push('framework wrappedNative must remain unconfigured');
  for (const key of ['multicall', 'importedTokenSwapWrapper']) {
    const entry = config[key];
    if (!isObject(entry) || entry.status !== 'pending_verification'
        || entry.address !== null || entry.verification !== null) {
      errors.push(`${key} must remain pending verification with no enabled address`);
    }
    const expectedAbi = key === 'multicall' ? 'abis/multicall3.json' : 'abis/imported-token-swap-wrapper.json';
    if (entry?.abi !== expectedAbi) errors.push(`${key} must use ${expectedAbi}`);
  }
  const sourceTypes = config.importedTokenSwapWrapper?.sourceReferenceTypes;
  if (!Array.isArray(sourceTypes) || !sameSet(sourceTypes, [0, 1, 3])) {
    errors.push('wrapper source reference types must be exactly 0, 1, 3');
  }
  if (!Array.isArray(config.dex?.allowedBrands)
      || !sameSet(config.dex.allowedBrands, ['uniswap', 'pancake'])) {
    errors.push('only uniswap and pancake DEX brands may be allowed');
  }
  if (!Array.isArray(config.dex?.deployments) || config.dex.deployments.length !== 0) {
    errors.push('framework must not enable unimplemented DEX deployments');
  }
  if (!isObject(config.platforms) || !sameSet(Object.keys(config.platforms), PLATFORM_IDS)) {
    errors.push('platform registry must contain flap, fourme, tagai, gang exactly');
  }
  for (const id of PLATFORM_IDS) {
    const platform = config.platforms?.[id];
    if (!isObject(platform)) {
      errors.push(`${id}: platform entry missing`);
      continue;
    }
    const expectedStatus = id === 'tagai' ? 'documented' : 'not_integrated';
    if (platform.status !== expectedStatus) errors.push(`${id}: live adapter not implemented`);
    if (platform.reference !== `references/platforms/${id}.md`) errors.push(`${id}: invalid platform reference`);
    if (!Array.isArray(platform.versions) || platform.versions.length !== 0) errors.push(`${id}: no versions are integrated`);
    if (!isObject(platform.capabilities)
        || !sameSet(Object.keys(platform.capabilities), CAPABILITY_IDS)) {
      errors.push(`${id}: exact capability set is required`);
    }
    for (const capability of CAPABILITY_IDS) {
      if (platform.capabilities?.[capability] !== false) errors.push(`${id}.${capability}: capability is not implemented`);
    }
  }
  return errors;
}

export function assertFrameworkConfig(config) {
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join('; '));
  return config;
}

export async function loadConfig(root) {
  return assertFrameworkConfig(JSON.parse(await readFile(new URL('config/bsc.json', root), 'utf8')));
}

export function summarizeCapabilities(config) {
  assertFrameworkConfig(config);
  return {
    phase: config.phase,
    chainId: config.chainId,
    tradingEnabled: false,
    networkAccess: false,
    walletAccess: false,
    commands: ['capabilities', 'validate'],
    tagaiOfflineCommands: ['deployments', 'read-plan', 'decode-read', 'encode'],
    allowedDexBrands: config.dex.allowedBrands,
    verifiedDexDeployments: 0,
    platforms: Object.fromEntries(PLATFORM_IDS.map(id => [id, {
      status: config.platforms[id].status,
      ...config.platforms[id].capabilities,
    }])),
  };
}
