# Batch Contract Reads

## Mandatory user rule

All batch contract reads use a verified Multicall deployment on the selected chain, such as Multicall3 `aggregate3`. Promise.all over independent eth_call requests, readContract loops, JSON-RPC batches, and individual sends with RPC batching disabled are not alternatives.

1. Verify RPC chainId=56. Read a block header, pin `blockNumber`, and record `blockHash`.
2. Use the verified Multicall address in config/bsc.json and its [ABI](../abis/multicall3.json). The live reader verifies its configured runtime hash before starting snapshot reads.
3. Encode target, callData, and allowFailure in a stable order within aggregate3. The outer `eth_call.to` must be the Multicall address and blockTag must be the pinned block.
4. Use Multicall again for dependent stages at the same block. Handle node capacity limits only by chunking Multicall calls; all chunks and retries stay on that block.
5. Restore results by index and validate length, success flags, and decoding. Optional fields may fail. If data required for the current decision fails, reject the whole result, including required issuance, trading state, configuration, balances, allowances, or executable quotes. Do not combine snapshots.
6. Detect reorganizations. If the hash at the pinned height changes, invalidate and restart the snapshot instead of mixing data.

## Caller semantics and non-view quotes

A Multicall subcall sees Multicall as msg.sender, not the original wallet. Pass account arguments explicitly to methods such as balanceOf and allowance. Do not use the snapshot as a substitute for full transaction simulation that depends on the real caller. Report and resolve incompatible caller semantics instead of falling back to independent eth_call requests.

aggregate3 itself is payable / non-view. Execute it through an outer eth_call, never broadcast it; its subcalls use CALL. Some Quoter / wrapper quote methods are non-view. Preserve their real ABI mutability and do not assume STATICCALL compatibility. Non-view subcalls can temporarily affect later observations within the same aggregate. Verify that quotes do not contaminate subsequent observations, or isolate them into separate Multicall chunks at the same pinned block.

A single independent contract read, or a block, receipt, or log query, is outside the batch-read rule. Do not split an inherently batched query into nominally independent reads to evade it.

## Required integration tests

- Intercept actual RPC transport and verify that every batched eth_call.to is the verified Multicall address.
- Decode aggregate3 and check targets, the full subcall set, order, allowFailure, and account arguments.
- Verify the same blockTag across dependent stages, chunks, and retries; restart the entire snapshot after a reorganization.
- Reject required subcall failures, missing data, and decode errors; explicitly label optional-field failures.
- Ensure capacity errors cannot trigger individual contract-call fallback.

The live implementation is scripts/lib/live-rpc.mjs. test/live.test.mjs checks actual serialized RPC transport, child targets and order, fixed blocks across phases / capacity splitting, required failures and reorganization rejection. The low-level offline request builder remains available for maintenance.
