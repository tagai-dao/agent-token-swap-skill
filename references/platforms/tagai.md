# TagAI Token Interaction

## Release scope

This reference now documents TagAI's BSC issuance, internal markets, and external DEX calls, with version-specific [ABIs](../../abis/provenance.json), a [deployment reference registry](../../config/tagai-bsc.json), and deterministic [offline tools](../tagai/tools.md).

**V5 and V8 are explicitly unsupported in this release, for both internal and external trading.** Recognizing either version must stop quotation and trade construction. Do not work around this exclusion by calling another version's ABI or treating the token as unclassified external issuance. V6 and V10 are imported-token records, not TagAI-native issuance. V12, V17, and unknown versions are outside this integration.

The tools do not contact RPCs, search APIs, or wallets, and never sign or broadcast. All imported deployment information is source-derived, not a fresh on-chain attestation. Runtime deployment checks, fixed-block reads, real-wallet simulation, and Binance preview remain mandatory. `config/bsc.json` retains false live-adapter flags; they describe bundled automation, not completion of the interaction documentation. Other platforms remain unintegrated.

Read in this order:

1. [Versions, identity, and state](../tagai/versions.md).
2. [Internal-market calls](../tagai/internal.md) or [external-market calls](../tagai/external.md), according to the verified state.
3. [Offline encoding and Multicall plans](../tagai/tools.md).
4. [Binance wallet](../binance-wallet.md) for each approval and transaction.

## User input and ticker candidates

The user supplies a token address or ticker and an amount / holding percentage. Select the market and DEX from verified data unless the user constrained the route.

The existing BSC backend implements:

```text
GET https://bsc-api.tagai.fun/community/search?tick=<URL-encoded-input>
X-Chain-Id: 56
```

The source route returns an array directly, not the usual `{c,d}` envelope. Fields include `chainId`, `token`, `tick`, `name`, `version`, `isImport`, `pair`, `dexVersion`, `createAt`, and `listedDayNumber`. Error objects are not successful search responses. Verify the live response shape before use.

Its source query matches ticker substrings case-insensitively, returns up to 30 records, and orders by `community.create_at` ascending. Show the first 3 usable BSC candidates in returned order, labeled as platform response order / oldest-first, not popularity. Show full addresses and import / unsupported-version labels. Ask the user to select the address, then verify issuance on-chain; API version and listing fields are hints only. An imported result does not acquire TagAI-native routing. Search code is documented but not bundled as a live CLI adapter.

## Route matrix

| Verified version | Internal buy | Internal sell | External market |
| --- | --- | --- | --- |
| 1 | Four arguments, including receiver | Standard four-argument sale | Direct Pancake V2 native/token route |
| 2, 3, 4 | Standard three-argument buy | Standard four-argument sale | Direct Pancake V2 native/token route |
| 5 | Unsupported by user instruction | Unsupported | Unsupported |
| 6 | Imported token; not native | Imported token; not native | Shared non-TagAI external workflow |
| 7 | Standard buy, version-specific return ABI | Standard sale | Direct Pancake Infinity CL |
| 8 | Unsupported by user instruction | Unsupported | Unsupported |
| 9, 11 | Standard buy | Standard sale | Direct Pancake Infinity CL |
| 10 | Imported token; not native | Imported token; not native | Shared non-TagAI external workflow |
| 13, 14 | Standard buy; dynamic fee / pending state | Standard sale | Direct native-BNB Infinity CL main pool |
| 15, 15-2, 16 | Standard buy plus nonempty buyer handle | Standard sale; no buyer-handle gate | Direct native-BNB Infinity CL main pool |

Never use ImportedTokenSwapWrapper or either legacy TagAI swap wrapper for native TagAI tokens in this skill. The older frontend still uses legacy wrappers for some V2 flows; copy the Router02 interface and on-chain pool facts, not that routing decision or its wrapper fee assumptions.

V13+ component pools and optimized split routes require separate full route validation and are documented as an extension boundary. This release's deterministic DEX builder selects the verified direct native main pool; it does not claim the best route across all component pools. Missing liquidity or an incompatible main pool means stop, not a fabricated multi-hop route.

## Required decision sequence

Resolve ticker -> prove issuer and exact Pump deployment -> enforce version exclusions -> read state at one block -> choose internal or external entry -> quote the actual amount with all applicable fees -> prepare approvals if needed -> refresh quote after approvals -> encode and independently decode -> simulate using the owned wallet -> wallet preview -> confirmation -> execute -> receipt / actual-output verification.

Deployment, ownership activation, listing finalization, and trading success are different states. Historical activation status is recorded in the registry for context, not as a current fact. The main contract workspace has uncommitted V17 changes; this integration uses the pinned deployed V16 source and exported version ABIs instead.
