# Repository instructions

## Mandatory Multicall rule

- All batch contract reads must use on-chain Multicall, such as Multicall3 aggregate3. This applies to every contract, frontend, API, service, script, chain, and agent.
- Promise.all over independent eth_call requests, readContract loops, JSON-RPC batches, and individual sends with RPC batching disabled are not Multicall and are prohibited as implementations or fallbacks.
- Organize dependent queries into Multicall stages. Pin all stages, chunks, and retries within one snapshot to the same blockTag. Single independent contract reads and block, receipt, or log queries are outside the batch-read rule.
- Handle node gas, response-size, or call-count limits only by splitting Multicall calls. Report and resolve missing deployments, failed calls, or incompatible caller semantics; never silently bypass the rule.
- Use the chain's verified Multicall address and ABI, preserve result order, handle subcall failures, and reject the full result when required data is missing.
- Changes to batch reads must include tests of the eth_call target, subcall set, and pinned block.
- This is an explicit user requirement. Future agents and subprojects must inherit it without weakening it.

## Product boundaries

- One installable skill; platform-specific instructions live in references/platforms. Keep all repository-authored instructions, documentation, metadata, and code comments in English.
- BSC only. User provides ticker or address; no proactive token discovery. The agent selects the route unless the user constrained it.
- External launchpad internal markets call platform contracts directly. TagAI uses its version-specific internal / external methods, never ImportedTokenSwapWrapper.
- Other external markets prefer ImportedTokenSwapWrapper; documented incompatibility permits direct DEX execution. Only verified Uniswap / PancakeSwap deployments and supported protocol variants are eligible.
- BNB is the entry / final asset. Platform settlement assets may require sequential swaps; persist progress and never silently repeat a completed leg or spend existing intermediate holdings.

## Integration discipline

- Read SKILL.md and references/integration-contract.md before adding an adapter. Do not invent platform contracts, endpoints, ABI signatures, fee formulas or test results.
- TagAI now has a live search / quote / simulation / Binance wallet adapter. Keep V5 and V8 excluded internally. Other platforms remain disabled until their adapters and tests exist. Do not expose version lists or implementation groupings in ordinary user responses.
- Keep source provenance for ABI files. Never copy production credentials, local paths, RPC tokens or private keys into this repository.
- Default to direct execution with existing agent RPC / ABI / Binance wallet tools. Do not require repository cloning, npm dependencies or script execution. scripts/trade.mjs is an optional runner that may query public data, simulate and obtain wallet previews. Only execute after explicit human confirmation of the exact displayed preview; no live trades during development without separate authorization. scripts/tagai.mjs remains an auxiliary offline tool, not the capability boundary.
- Run `npm run validate`, `npm test` and the skill-creator validator for skill changes. For contract batch readers, add transport-level Multicall tests when implemented; documentation checks cannot replace them.
