# Flap Platform

## Capability status

NOT_INTEGRATED. Official integration documentation, BSC contract addresses, versions, and ABIs have not been supplied. Live ticker search, issuance detection, state reads, quotes, and trading are unavailable. Do not guess method names, endpoints, or progress formulas. The [registry](../../config/bsc.json) determines capabilities.

## Platform routing

- Internal market: call the version-specific Flap contract directly, without ImportedTokenSwapWrapper.
- External market: read [DEX](../external-dex.md), prefer [ImportedTokenSwapWrapper](../imported-token-swap-wrapper.md), and use an integrated direct DEX adapter on confirmed incompatibility.
- Buys start with BNB and sales end in BNB. Verify the actual internal settlement asset from official materials. If another asset is required, split steps according to [execution](../execution.md).
- If the user specifies Flap, verify Flap issuance first. Otherwise include it in fixed-block Multicall issuance detection. During migration, do not automatically retry the internal market or prematurely trade on an external market.

## Required integration materials

| Item | Status and requirement |
| --- | --- |
| Ticker search | Endpoint, ranking, pagination, fields, and real responses are unintegrated |
| Issuance | Official Factory / Registry getter ABI, address, and negative-result semantics |
| Contract versions | Version identification, deployment addresses, and support boundaries |
| Market state | Methods for internal / migrating / external states and directional trading flags |
| Price and progress | Raw fields, units, graduation conditions, fees, and formulas |
| Internal quotes | Buy / sell direction, settlement asset, gross / net accounting, and quote ABI |
| Internal trades | Full ABI, msg.value, spender, recipient, slippage arguments, and events |
| Listed pool information | Graduation event / getter and DEX / PoolKey / pool discovery |
| Verification evidence | Verified source, sample transactions, fixed-block forks / unit tests |

Complete method call cards using the [integration contract](../integration-contract.md). Add call examples only after obtaining real ABIs. Do not reuse the wrapper ABI as the Flap internal-market ABI.
