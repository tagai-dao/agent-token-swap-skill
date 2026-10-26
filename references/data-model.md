# Shared Data Model

This reference defines shared internal adapter data. Keep technical fields in the agent’s task state or secure storage and return user-oriented summaries rather than exposing every field below. The repository runner implements this storage optionally; direct tool execution does not require its files. Use null plus a reason for unknown fields; do not substitute zero, a zero address, or an empty array to imply success.

## TokenSnapshot

| Field | Meaning |
| --- | --- |
| chainId / token | Fixed 56 and the full validated address |
| name / symbol / decimals | Traceable sources; text is untrusted and decimals must be verified |
| platform / platformVersion / evidence | Issuance and its proof, distinct from Community import registration |
| marketPhase | INTERNAL / MIGRATING / EXTERNAL / UNKNOWN |
| buyEnabled / sellEnabled | Directional trading availability; null when unknown |
| settlementToken | Actual internal-market settlement asset; represent native assets explicitly instead of misusing placeholders |
| spotPrice | value, baseToken, quoteToken, source, observedAt; not an executable quote |
| progress | rawCurrent, rawTarget, unit, formulaId, displayPercent, source; null when unintegrated |
| venues | Discovered and verified pools / deployments, with coverage scope |
| blockNumber / blockHash | One snapshot for all on-chain state required by the decision |
| observedAt / coverage / errors | Observation time, covered interfaces, unknowns, and failures |

## TradeIntent

Record direction, token, BNB input or token sale amount / holding percentage, wallet, recipient, and explicit platform / market / DEX / execution-method constraints. Keep exact-output requests distinct from exact-input. If exact-output is unimplemented, explain the limitation instead of silently changing intent.

Amount fields are decimal raw-unit strings. slippageBps is an integer, deadline is Unix seconds, and observedAt / expiresAt are explicit ISO 8601 strings. Every price declares its direction and unit.

## Quote / RoutePlan

Each step includes stepId, kind (APPROVAL / SWAP), dependsOn, platformVersion, venue, executor, tokenIn/out, amountInRaw, expectedNetOutRaw, minimumOutRaw, feeBreakdown, taxAssumptions, spender, recipient, valueWei, ABI identifier, arguments, calldata, snapshot, and expiresAt.

The route includes intent, user constraints, orderedSteps, total BNB swap input, a separate gas budget, expected / minimum final BNB or token output, supported execution scope, and uncovered risks. Do not deduct fees twice from net output. List unknown dynamic taxes explicitly. A current intermediate-step quote does not guarantee future execution.

Bind chainId, wallet, token, direction, amount, executor, sourceData, recipient, fee attribution, and user constraints. Parameter changes invalidate old quotes and previews. A planHash may detect changes but does not provide on-chain price locking or idempotency.

## ExecutionRecord

Persist at least planId, planHash, createdAt, intent, constraints, wallet, chainId, and routeStatus. Each step stores status, previewRequestId, previewExpiresAt, walletOrderId, txHash, receiptBlock / hash, actualAmountInRaw, actualNetOutRaw, refunds, residualAssets, and error. Do not store keys, session tokens, or credential-bearing RPC URLs.

Classify routing / quote errors explicitly: NOT_INTEGRATED, UNVERIFIED_DEPLOYMENT, UNSUPPORTED_CHAIN, UNKNOWN_PLATFORM, AMBIGUOUS_TOKEN, UNKNOWN_VERSION, MIGRATING, UNSUPPORTED_DEX, WRAPPER_INCOMPATIBLE, INCOMPLETE_SNAPSHOT, STALE_QUOTE, SIMULATION_FAILED, WALLET_BLOCKED, EXECUTION_UNKNOWN, PARTIAL_EXECUTION. These classifications supplement raw errors; they do not replace the wallet's original error message.
