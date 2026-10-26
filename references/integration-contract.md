# Platform Integration Contract

Treat each future platform as a separate integration task and read its reference first. Do not implement trading without user-provided or trusted-source ABIs and addresses. Keep SKILL.md, configuration, and this contract consistent.

## Required platform documentation

1. Official sources, BSC deployments, versions, proxy relationships, deployment / verification evidence, and dates.
2. Ticker search interfaces, parameters, pagination, ranking, sample responses, and failure semantics.
3. Issuance-proof getter / Registry / Factory ABIs and MATCH / NO_MATCH / UNKNOWN rules.
4. Internal / migrating / external states, directional trading flags, raw progress data and formulas, reference prices, and quote assets.
5. Internal-market settlement assets, quotes, buys, sales, approvals, events, and custom errors.
6. External-pool discovery for each version. TagAI must document version-specific routes separately.
7. Amount-specific quotes, all fees, dynamic taxes, and the exact meaning of final minimum delivery.
8. Complete BNB buy / sell routes, necessary intermediate swaps, approval amounts, and failure recovery.

## Method call cards

For each method, include the full Solidity signature, exact JSON ABI, stateMutability, selector calculated from the ABI, to, from, msg.value, spender, each argument's type / units / meaning / source / valid range, exact tuple order and encoding, return decoding, fee inclusion, prerequisites, events, errors, and simulation using the real from.

Provide at least one fixed-input calldata encoding / decoding example. Do not guess selectors. Preserve non-view quote mutability and execute quotes through eth_call, never broadcast them. Distinguish gross output, net output, and final recipient delivery.

## Implementation boundaries

Platform adapters own search, buildProvenanceCalls, decodeProvenance, buildStateCalls, decodeState, quotes, and internal-market calldata construction. Shared layers own fixed-block Multicall, DEX / wrapper routing, wallets, and execution records. Do not implement separate individual-RPC readers per platform.

The live executor is not implemented. scripts/trade.mjs supports capabilities / validate; scripts/tagai.mjs adds source-derived offline read plans, decoding, and unsigned calldata. These helpers do not establish live quotes, deployment verification, or execution. Real commands require capability gating and behavioral tests; changing config.status to ready must not enable nonexistent methods.

## Address and ABI verification

Deployment evidence must include chainId, address, version, verification time / block, code or proxy implementation identity, source, and ABI SHA-256. Obtain ABIs from matching compiled sources or verified official materials. Handle immutables and proxies correctly; do not require an unnormalized artifact to equal deployed runtime bytecode.

Register each DEX deployment explicitly. The brand must be uniswap or pancake; declare protocol version, Factory / Router / Quoter / Manager / Vault / wrappedNative, and supported directions. Verify wrapper deployments, actual ABIs, fees, and bridge routes separately. Local source support is not proof of production capability.

## Enablement acceptance criteria

- Successful identification, explicit negatives, failed queries, unknown versions, platform conflicts, and imported-token issuance distinctions.
- Duplicate ticker candidates, incomplete search coverage, and user route constraints.
- Internal buys / sales, migration boundaries, external buys / sales, and complete BNB routes in both directions.
- Correct approval spender, allowance-reset behavior, taxed-token / Hook support by direction, fees, and final minimum output.
- Multicall transport target, subcalls, fixed blocks, required-failure rejection, chunks, retries, and reorganizations.
- Agreement between quoted and executed pools, full calldata decoding, and real-wallet simulation.
- Actual intermediate output, retention after later-step failure, no repeated trades after unknown broadcasts, and recovery from pending App confirmation.
- Use unit tests and fixed-block forks by default; do not send real funds. Live mainnet transactions require separate user authorization.

Update capabilities together with implemented adapters, tests, documentation, and sufficient evidence. Explicitly enable only verified versions and directions. All trading capabilities remain disabled in this framework release.
