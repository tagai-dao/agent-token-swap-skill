# Token Inputs, Candidates, and Issuance

TagAI, [Flap](platforms/flap.md) and [GANG](platforms/gang.md) have a live [direct tool workflow](tool-native.md) and optional runner. Fourme remains unintegrated. GANG proofs read curves(address) on all five registered launchpads with the correct tuple layouts. Flap proofs include ordinary Portal state and ID Agent Factory market / predicted-token bindings. Apply these shared resolution rules without turning internal adapter details into user-facing explanations.

## Address input

Keep a supplied address as the selected asset. Classify it with all integrated proof interfaces, including ordinary Flap Portal independently of the ID Agent Factory. The [AIPRO address example](flap/worked-examples.md#query-a-contract-address-aipro) has a positive ordinary Portal record, negative ID Agent / TagAI proofs, and an SPCXB internal price. A different same-symbol TagAI token remains a separate asset.

For `https://flap.sh/bnb/<address>` links, including language/query parameters, extract and validate the path address, then follow the address workflow. Example: `https://flap.sh/bnb/0xeac597ba087f6219c03a65479b2568d3f9a07777?lang=zh` selects `0xeac597Ba087f6219C03a65479B2568d3f9A07777`. This uses on-chain reads directly; the page and ticker-search HTTP endpoints are unnecessary. Follow the [concrete lookup example](flap/worked-examples.md#query-a-flap-token-link-aipro).

For `https://gang.fun/token/<address>`, extract the path address and follow the same workflow with every [registered GANG pad](../config/gang-bsc.json). A nonzero curves.creator proves issuance; zero pair on an internal market is expected.

Validate the 20-byte EVM address, mixed-case checksum, chainId=56, and contract code. If the user specifies a platform, check that platform's issuance-proof interface first. Otherwise assemble a Multicall across all integrated platform proof interfaces. Names, symbols, suffixes, and the presence of a method do not prove issuance.

Each platform proof returns MATCH / NO_MATCH / UNKNOWN, with platform version, proof contract, method, and snapshot. RPC failures, decode failures, missing integrations, and unknown versions are UNKNOWN, not NO_MATCH. Only a normal negative result defined by the interface is NO_MATCH.

If multiple platforms return MATCH, use creation Factory / Registry evidence to resolve the conflict. Do not trade while the conflict remains unresolved. A TagAI import binding is not TagAI-native issuance. If the named platform disagrees with the evidence, show the discrepancy instead of silently changing platforms.

Only after all relevant platforms explicitly return NO_MATCH may the token proceed as an ordinary external token to supported DEX checks. An UNKNOWN result means platform exclusion is incomplete. Obtain the missing evidence rather than using the ordinary-token branch to bypass missing integrations.

## Ticker input

Filter by the user's platform when explicitly specified; otherwise query integrated search interfaces. Show the first 3 results from each by default, preserving the source's native order and naming its ranking basis. If the API does not document ranking, label it "platform response order." This resolves the user's input; it is not trending-token discovery or a recommendation.

Show name, symbol, full address, platform, sources, and available distinguishing fields such as market phase, liquidity, or creation time. Optional fields must come from real data; do not fabricate missing values. Deduplicate by chainId + address while preserving multiple-source labels.

A unique exact ticker match may proceed automatically to information or transaction preview, with its full address shown. The user confirms the transaction preview before sending. If multiple candidates remain, ask the user to select an address; ranking alone never selects a token. Report search coverage gaps on API failure rather than claiming the ticker does not exist. When search fails, return SEARCH_UNAVAILABLE and identify coverage gaps. Flap ID Agent registry search may still work even when ordinary Flap HTTP search is unavailable. The user may supply an address instead; the runtime must still verify its issuer and market before preparing a trade.

## Dependent reads

Follow [Multicall](multicall.md): pin the block first, query issuance and version in stage A, then read version-specific market state in stage B at the same block. A snapshot refresh requires recalculating the full route.
