# GANG Platform and Intermediate Settlement

## Capability status

NOT_INTEGRATED. GANG settlement in the internal market is a user-provided requirement. The actual GANG address, decimals, platform ABI, settlement rules, and external conversion routes remain unverified. Do not choose an asset based only on symbol=GANG. Search, identification, quotes, and execution are unavailable. The [registry](../../config/bsc.json) determines capabilities.

## Platform routing

```text
Internal buy:  BNB -> verified GANG -> internal-market target token
Internal sell: internal-market target token -> verified GANG -> BNB
```

Call the GANG platform contract directly for the internal-market step, without the wrapper. Intermediate GANG / BNB swaps follow the rules for other non-TagAI external tokens: prefer [Wrapper](../imported-token-swap-wrapper.md), then use a supported [DEX](../external-dex.md) directly on confirmed incompatibility.

If the target is already external, plan against its current external pools rather than forcing a GANG intermediate. Only integrated Uniswap / PancakeSwap deployments are eligible; a platform settlement requirement does not authorize another DEX.

## Meaning of two swaps

- The user requests a BNB-funded buy / sale back to BNB. Do not require them to prepare GANG or select a DEX.
- For buys, estimate the complete route first. After BNB-to-GANG confirms, requote the internal buy using actual net GANG received.
- For sales, estimate the complete route first. After target-token-to-GANG confirms, requote GANG-to-BNB using actual net GANG received.
- Do not consume pre-existing wallet GANG by default. Keep platform caller, final recipient, and intermediate-asset ownership explicit.
- GANG / target-token approval transactions may be required in addition to the two swaps. Show all actual steps instead of promising exactly two on-chain transactions.
- If the first step succeeds and the next fails, GANG remains in the wallet. Follow [execution recovery](../execution.md), mark PARTIAL, and do not repeat the first step, automatically swap back, or expand the budget.

## Required integration materials

Obtain ticker search, issuance proof and versions, internal state / progress / prices, the GANG address and decimals, internal quote / trading ABIs, gross / net GANG settlement accounting, actual spenders, fee / minimum-size / refund / slippage rules, migration and external-pool data, and verified supported BNB-to-GANG and GANG-to-BNB routes.

Use the [integration contract](../integration-contract.md) to document each internal direction and intermediate conversion with method cards and evidence. Do not copy a BNB-funded internal buy's msg.value conventions from another platform into GANG internal trading.
