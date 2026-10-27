# TagAI Token Interaction

## Start with a worked example

Read [worked examples](../tagai/worked-examples.md) first for information queries, amount quotes and purchases / sales. It specifies the search URLs, actual candidate addresses, ordered fixed-block call sets, exact method arguments, integer calculations, transaction fields and wallet confirmation flow. Use its TTAI external recipe or AIPRO internal recipe according to the observed state. Do not invent a different sequence or replay historical prices / calldata. The recipes are executable through existing tools without installing this repository.

## Internal support boundary

Use [direct tool execution](../tool-native.md) for ordinary requests: resolve tickers, read BSC state, quote, simulate, obtain a Binance wallet preview, and send the confirmed transaction with the agent’s existing tools. No repository clone or npm installation is required. The [repository runner](../runtime.md) automates the same checks when available, but is optional. The version-specific [ABIs](../../abis/provenance.json), [deployment reference registry](../../config/tagai-bsc.json) and auxiliary [offline tools](../tagai/tools.md) below are internal implementation references.

**V5 and V8 are explicitly unsupported in this release, for both internal and external trading.** Recognizing either version must stop quotation and trade construction. Do not work around this exclusion by calling another version's ABI or treating the token as unclassified external issuance. V6 and V10 are imported-token records, not TagAI-native issuance. V12, V17, and unknown versions are outside this integration.

TagAI live flags are enabled in config/bsc.json. The runtime verifies issuance, token identity, market state and pool bindings per request; it uses fixed-block Multicall and real-wallet simulation, then requires confirmation of the Binance preview before sending. Do not explain version families or excluded-version lists in ordinary user replies. Report the token information, price, market and trade preview; surface only a relevant actionable blocker. Flap is also integrated for its documented subset; Fourme and GANG remain unintegrated.

Read in this order:

1. [Worked examples](../tagai/worked-examples.md), then [versions, identity, and state](../tagai/versions.md).
2. [Internal-market calls](../tagai/internal.md) or [external-market calls](../tagai/external.md), according to the verified state.
3. Use the existing ABI / RPC tools for encoding and Multicall; [offline helpers](../tagai/tools.md) are optional.
4. [Binance wallet](../binance-wallet.md) for each approval and transaction.

## User input and ticker candidates

The user supplies a token address or ticker and an amount / holding percentage. Select the market and DEX from verified data unless the user constrained the route.

The existing BSC backend implements:

```text
GET https://bsc-api.tagai.fun/community/search?tick=<URL-encoded-input>
X-Chain-Id: 56
```

The source route returns an array directly, not the usual `{c,d}` envelope. Fields include `chainId`, `token`, `tick`, `name`, `version`, `isImport`, `pair`, `dexVersion`, `createAt`, and `listedDayNumber`. Error objects are not successful search responses. Verify the live response shape before use.

Its source query matches ticker substrings case-insensitively, returns up to 30 records, and orders by `community.create_at` ascending. Show the first 3 usable BSC candidates in returned order, labeled as platform response order / oldest-first, not popularity. Show full addresses and relevant issuer information. A unique exact ticker can proceed automatically; ambiguous candidates require user selection. Verify issuance on-chain; API version and listing fields are hints only. Keep unsupported-version and implementation labels out of routine user output. An imported result does not acquire TagAI-native routing. The search endpoint is used by the live CLI adapter.

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
