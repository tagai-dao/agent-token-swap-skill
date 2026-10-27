# TagAI Versions, Identity, and State

## Source and deployment registry

Read [tagai-bsc.json](../../config/tagai-bsc.json) for exact Pump addresses, interface files, version aliases, excluded releases, and infrastructure. Read [source evidence](../../config/tagai-source-evidence.json) and [ABI hashes](../../abis/provenance.json) for provenance.

Every address is BSC-only. The V15-2 deployment still reports `VERSION() == 15`; distinguish it from V15 by Pump address, not the numeric version alone. V14 reuses the V13 Token implementation / interface. V11 uses the V9 trading interface but a different Pump and deployment. V5 and V8 are excluded regardless of market phase.

The source registry is a discovery starting point. Before signing, verify each relevant deployment at the chosen block: runtime code / verified implementation identity, expected chain, ABI identity, and infrastructure bindings. For modern clones, check the canonical EIP-1167 clone implementation against the Pump deployment's recorded Token implementation and fresh Pump.tokenImplementation(), accounting for legitimate template changes explicitly. An arbitrary token's self-reported method is not issuance evidence.

## Fixed-block identification

1. Read chainId and a block header from the selected BSC RPC. Save numeric blockTag, block number, hash, and timestamp.
2. Submit a Multicall over trusted Pump `createdTokens(token)` getters. The [read interface](../../abis/tagai/read-interfaces.json) contains the getter; not every historical exported Pump ABI includes it.
3. A successful true result is a trusted positive proof for that exact Pump. A successful false is only that Pump's negative result. Revert, missing method, malformed data, or an unqueried Pump is UNKNOWN.
4. Check clone / deployment evidence and the matched version's required state. Multiple positive proofs require investigation before trading. Do not let API labels override the proof.
5. A V5 match is identifiable but not tradable. V8 is outside the executable support scope even if the user supplied a known deployment. Do not turn unsupported TagAI into generic external tokens.

The offline issuance plan includes getters explicitly represented by the available historical / modern ABI evidence. V1 createdTokens(address) is now verified on the trusted deployed Pump with both a positive TTAI and negative control, using the registered read-interface ABI; the historical Pump ABI export omits it. See the dated evidence in the deployment registry and [worked example observations](../../config/tagai-worked-examples.json). V7 and V8 still have incomplete proof coverage in the historical exports. For V7 obtain a trusted creation event or verified Factory proof before executing. The same Multicall can include additional source-verified getters when available. Missing historical coverage is never a clean all-platform NO_MATCH. V8 remains unsupported even if its proof is later obtained.

Creation-event evidence must match the trusted emitter, event ABI, token and block / receipt. Logs are allowed outside the contract batching rule, but event names and indexed layouts must come from the matching ABI, never guesses.

The supplied historical ABIs provide a concrete fallback for the incomplete V1 / V7 getter coverage:

| Pump ABI | Creation event layout |
| --- | --- |
| V1-V4 | `NewToken(string tick,address indexed token,address indexed creator)` |
| V7 | `NewToken(string tick,address token,address creator)`; token and creator are in data, not indexed topics |
| V9 (also V11 interface) | `NewToken(string tick,address token,address creator)` |
| V13-V16 | `NewToken(string tick,address indexed token,address indexed creator)` |

Use the matched Pump ABI to decode the original receipt / log, require its emitter to equal the trusted Pump address, and compare the decoded token to the user-selected address. An API creation hash may locate a receipt but is not itself proof. For a bounded getLogs search, use the exact ABI's event topic and indexing; do not put a V7 token into a nonexistent indexed-token topic. Verify the canonical creation block / receipt and reconcile it with current clone / runtime identity. This event path can establish V1 / V7 issuance without treating missing getters as false. It does not enable excluded V5 / V8 trading.

## Market-state reads

At the same block, batch the methods actually present on the matched Token / Pump:

| Field or getter | Use |
| --- | --- |
| `listed()` | Determines whether the bonding curve has ended |
| `listingPending()` for V13+ | Pending listing blocks both bonding-curve directions; do not infer it for legacy versions |
| `bondingCurveSupply()` | Current curve supply, used for progress and quotes |
| `decimals()`, `balanceOf(wallet)` | Base units and available seller holdings |
| `bondingCurve()` for modern versions | Actual curve pricing contract; bind it to the trusted Pump / deployment |
| `getBuyFeeRatios()` where source-verified | Actual current buy ratios, including anti-snipe changes |
| Pump `getFeeRatio()` | Normal sell fee split and version-specific baseline |
| `v4PoolId()` where applicable | Native listing pool identifier; not an EVM pair address |
| `listingHook()`, `listingPoolParameters()`, `listingInfrastructure()`, `clPoolManager()`, `vault()` for V13+ | Token-bound listing snapshot; check method presence against its ABI |
| `handleOf(wallet)` at the registered HandleRegistry for V15 / V15-2 / V16 internal buys | Empty string means ineligible; read failure means eligibility unknown |

Required missing fields reject the decision. Optional names / display metadata may be unavailable without changing trade facts. Do not fill missing chain data with API defaults.

If listed=false and a verified pending flag is true, report MIGRATING and stop. If listed=true, use the listing snapshot and DEX state, never the bonding-curve quote. Legacy ABI omissions do not justify calling arbitrary modern getters and treating failure as false.

## Progress and reference prices

For the pinned V13-V16 source family, the private curve cap is `650000000 * 10^18` token units. It is a source constant, not an exposed `bondingCurveTotalAmount()` getter. With verified decimals=18:

```text
progressBps = floor(bondingCurveSupply * 10000 / 650000000000000000000000000)
```

State the basis as curve tokens sold / source-verified curve cap. Do not infer EXTERNAL from 100%; listing may be pending. Apply a legacy cap only after checking that version's source.

For an internal reference price, call the curve's exact price method for a declared small token increment and describe it as that increment's price, not a guaranteed executable order or mathematical derivative. For external Infinity native/token pools, sqrtPriceX96 expresses raw token / raw BNB; the reference BNB wei per whole token is `floor(2^192 * 10^decimals / sqrtPriceX96^2)`. This ignores trade size and fees; obtain a real Quoter result for trading.
