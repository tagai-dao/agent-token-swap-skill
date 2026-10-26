# Token Inputs, Candidates, and Issuance

All four platforms are currently unintegrated. This reference defines future behavior and does not provide callable platform interfaces.

## Address input

Validate the 20-byte EVM address, mixed-case checksum, chainId=56, and contract code. If the user specifies a platform, check that platform's issuance-proof interface first. Otherwise assemble a Multicall across all integrated platform proof interfaces. Names, symbols, suffixes, and the presence of a method do not prove issuance.

Each platform proof returns MATCH / NO_MATCH / UNKNOWN, with platform version, proof contract, method, and snapshot. RPC failures, decode failures, missing integrations, and unknown versions are UNKNOWN, not NO_MATCH. Only a normal negative result defined by the interface is NO_MATCH.

If multiple platforms return MATCH, use creation Factory / Registry evidence to resolve the conflict. Do not trade while the conflict remains unresolved. A TagAI import binding is not TagAI-native issuance. If the named platform disagrees with the evidence, show the discrepancy instead of silently changing platforms.

Only after all relevant platforms explicitly return NO_MATCH may the token proceed as an ordinary external token to supported DEX checks. An UNKNOWN result means platform exclusion is incomplete. Obtain the missing evidence rather than using the ordinary-token branch to bypass missing integrations.

## Ticker input

Filter by the user's platform when explicitly specified; otherwise query the four integrated search interfaces. Show the first 3 results from each by default, preserving the source's native order and naming its ranking basis. If the API does not document ranking, label it "platform response order." This resolves the user's input; it is not trending-token discovery or a recommendation.

Show name, symbol, full address, platform, version if known, sources, and available distinguishing fields such as market phase, liquidity, or creation time. Optional fields must come from real data; do not fabricate missing values. Deduplicate by chainId + address while preserving multiple-source labels.

Have the user select an address before trading. An exact ticker match, first-place ranking, or single result does not substitute for address confirmation. Report search coverage gaps on API failure rather than claiming the ticker does not exist. When search is unavailable, return NOT_INTEGRATED. The user may supply an address instead, but that does not imply address-based trading is already available.

## Dependent reads

Follow [Multicall](multicall.md): pin the block first, query issuance and version in stage A, then read version-specific market state in stage B at the same block. A snapshot refresh requires recalculating the full route.
