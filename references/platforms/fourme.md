# Fourme Platform

## Capability status

NOT_INTEGRATED. "Fourme" preserves the user's platform name. The official product identity, materials, and BSC deployments are unverified; do not substitute a similarly named platform automatically. Live search, issuance detection, state reads, quotes, and trading are unavailable. The [registry](../../config/bsc.json) determines capabilities.

## Platform routing

- Internal market: call the confirmed version's native Fourme ABI directly, without the wrapper.
- External market: verify [DEX](../external-dex.md) data, prefer [Wrapper](../imported-token-swap-wrapper.md), and allow an integrated direct DEX adapter on confirmed incompatibility.
- Buys start with BNB and sales end in BNB. Verify the internal settlement asset and add an intermediate swap if it differs.
- A user-named platform does not replace on-chain issuance and version checks. Distinguish normal negative proof results from failed calls.

## Required integration materials

| Item | Status and requirement |
| --- | --- |
| Platform identity and ticker search | Official sources, endpoint, native ranking, pagination, and duplicate-ticker fields are pending |
| Issuance and versions | Factory / Registry, manager or helper roles, exact ABIs, and negative-result semantics are pending |
| Market phase | Migration and trading flags, graduation conditions, and external-market mapping are pending |
| Price and progress | Raw data, precision, quote assets, and progress formulas are pending |
| Trades and quotes | Version-specific methods, settlement assets, fees, minimum sizes, slippage, and refund accounting are pending |
| Approvals and execution | Actual spender, msg.value, recipient, events, and custom errors are pending |
| Behavioral evidence | Successful transaction examples, failure semantics, and fixed-block verification are pending |

Complete each version using the [integration contract](../integration-contract.md). A callable method from another version does not prove that it is the correct trading interface for the current token.
