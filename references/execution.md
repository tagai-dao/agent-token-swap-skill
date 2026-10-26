# Execution, Approvals, and Multi-Step Recovery

## Amounts and budget

Buys start with BNB; sales end in BNB. Display swap input and gas separately. For "all BNB," reserve gas for every step before calculating spendable input. Do not silently reduce an ordinary exact amount; report insufficient balance first. Resolve holding percentages from the quote snapshot with integer rounding down.

Do not use JS Number for amounts. Parse human-readable decimals into raw units and output strings. Use integer slippageBps. Round minimumOut down from final net output after known fees, avoid double-counting fees, and do not assume an unknown dynamic tax is zero.

The approval spender is the contract that actually calls transferFrom on the wallet. An internal platform may not need approval; wrapper sales normally approve the wrapper. Direct DEX and Permit2 spenders depend on the specific implementation. Tokens requiring allowance reset use separately verified steps. Default to finite approval; do not automatically grant unlimited Permit / Permit2 authority.

## Intermediate settlement assets

GANG is an example; the actual interfaces remain unintegrated:

```text
Buy:  BNB -> GANG -> internal-market token
Sell: internal-market token -> GANG -> BNB
```

Quote the entire route first, with per-step minimum outputs, fees, and budget. After the first transaction confirms and its actual output is established, refresh internal-market state, version, balances, and the next quote before constructing the next transaction. Additional approval transactions may be required; simulate and preview each transaction separately.

By default, a later step spends only the net intermediate output produced by this route, without consuming pre-existing intermediate holdings. Establish route proceeds from transaction events and delivery evidence rather than counting unrelated incoming transfers. Include existing intermediate holdings only when explicitly authorized by the user.

Do not independently apply the full route's slippage allowance to every step without checking the compounded final result. Before the next preview, verify that its minimum output still fits the user's complete authorization. If it does not, explain the remaining choices without increasing input or weakening protection. Cross-transaction atomicity is unavailable, and a quote cannot guarantee that the second step will succeed.

## Persistent execution state

The future executor must save records atomically under local `.state/`, outside Git, without session credentials. See the minimum fields in the [data model](data-model.md). Record preparation state before a wallet command and save requestId / orderId / txHash immediately after its response.

Step states:

```text
PLANNED -> PREVIEWED -> AWAITING_USER / AWAITING_APP
        -> SUBMITTED -> CONFIRMED
Any unconfirmed step -> FAILED / EXPIRED / UNKNOWN
Route: PLANNED / IN_PROGRESS / PARTIAL / COMPLETED / FAILED
```

UNKNOWN means broadcast status is unresolved, not failed. Reconcile wallet orders, transaction locks, history, and on-chain receipts before executing or repeating the step. A local planId alone does not provide on-chain idempotency when the wallet has no reliable idempotency guarantee.

- PENDING_CONFIRMATION: wait for the App action; do not create a duplicate order.
- BROADCASTED: record the hash and query its receipt; do not report a completed trade.
- receipt status=0: the transaction failed; account for asset changes and gas separately.
- Verify actual delivery and required confirmations before depending on a preceding step. Confirmation policy comes from verified configuration and reorganization detection; this framework does not invent a fixed count.
- Failure after a completed step: mark PARTIAL and report intermediate holdings, the failed step, and the quote needed to resume. Do not repeat the first step or automatically swap back.

## User constraints and wallet confirmation

Authorization of a multi-step intent does not authorize arbitrary new addresses, additional funds, or wider slippage. Each transaction follows the preview and confirmation requirements in the [wallet reference](binance-wallet.md). Persist explicit user constraints and preserve them during recovery.
