# TagAI Platform and Version Routing

## Capability status

NOT_INTEGRATED. This repository does not yet include the complete TagAI version ABIs, issuance mappings, DEX deployments, and verified routes. Do not perform live queries or trades. Existing main-project code can inform later integration, but its local configuration does not automatically become a verified deployment in this skill. The [registry](../../config/bsc.json) determines capabilities.

## Identity and version

TagAI-native issuance requires on-chain evidence from the relevant Pump / Factory / Registry. Selecting "TagAI" or binding an external token to a TagAI Community does not establish native issuance.

Use fixed-block Multicall to identify issuance before reading version-specific state. Map Pump, Token implementation, listing snapshot, Hook, Manager, and settlement assets explicitly. Do not apply the latest ABI to an unknown version. A legacy compatibility getter does not establish the full scope of multi-Pump support.

## Platform routing

- Internal market: call the version-specific Token / platform trading methods directly, without the wrapper.
- External market: use the version's required DEX entry point and associated methods, without ImportedTokenSwapWrapper. Third-party wrapper fallback rules do not apply to TagAI-native tokens.
- "Direct DEX" means the verified Router / Manager / callback-capable execution entry point, not sending wallet transactions to a bare pool, vault callback, or arbitrary helper.
- If a version needs a dedicated TagAI executor for Hook / component routes, its exact identity, DEX execution semantics, and compatibility with the user's requested method belong in that version's method call cards. Do not silently reuse a historical executor.
- BNB is the entry and final asset. Version rules determine components, bridges, and pool splits; users should not have to guess routes.

## Required version matrix

Record the following for every supported version. No version is currently enabled:

| Item | Required detail |
| --- | --- |
| Version identification | Issuing Pump / implementation and proof method |
| Internal methods | Exact signatures, quotes, fees, slippage fields, msg.value, and approval requirements |
| Migration state | Actual listed / pending field semantics and directional trading availability |
| Listing pool | DEX protocol, PoolKey / poolId, native / wrapped assets, Manager, and Hook snapshot |
| External trades | Exact ABI, spender, recipient, Hook data, refunds, and minimum delivery |
| Multiple pools / components | Support, candidate sources, taxes, execution order, and bridge routes |
| Price and progress | Exact formulas, net-output accounting, and data sources |
| Behavioral evidence | Version-specific buys / sales, migration boundaries, and fee / Hook verification |

Use the token's actual bound listing PoolKey and Hook snapshot. Do not replace an older token's configuration with the latest Hook. Document Uniswap / Pancake pool structures and hookData encoding separately. Fee-subject arguments such as subject / sellsman are not the router or recipient.

## Future integration

Define an explicit version scope under the [integration contract](../integration-contract.md). Add source / ABI / deployment provenance, issuance proof, and internal methods, followed by external-market variants. Do not infer progress, price, or executable quotes solely from legacy UI display logic. Explain unknown versions or incompatible user constraints and stop; do not fall back to the wrapper.
