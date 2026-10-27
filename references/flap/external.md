# Flap External Markets

Read [Flap](../platforms/flap.md), [DEX verification](../external-dex.md) and [wrapper methods](../imported-token-swap-wrapper.md). Graduated Flap tokens prefer ImportedTokenSwapWrapper. Internal ordinary Portal and ID Agent share trades never use it; native TagAI tokens retain their own direct-DEX route.

## Connected route

PancakeSwap V2/WBNB with [verified wrapper deployment](../../config/flap-bsc.json) is connected for ordinary non-tax and Tax Token V3 rules. Other quote assets, older tax behavior, V3 and CL need additional adapters. Missing coverage is not wrapper incompatibility. Do not silently execute external swaps through Flap Portal even when its newer ABI supports them.

At one snapshot verify Portal.status=DEX and dexId=0 (Pancake on BSC); the listing pair's factory/token0/token1; Factory.getPair(token,WBNB)=that exact pair; Router.factory / WETH; positive reserves; wrapper runtime, paused=false, wrappedNative=WBNB and configured NutboxRouter binding. Sale allowance belongs to Wrapper.

```text
sourceType = 0
sourceData = abi.encode(tuple(address router,address pair))
router = 0x10ED43C718714eb63d5aA57B78B54704E256024E
pair = verified actual listing pair
```

This is one ABI-encoded struct, not JSON or function calldata. The router selects its pair from the path, so a pair address alone is insufficient verification. Never accept an arbitrary API router.

## Taxes and net quote

Wrapper.quoteBuy / quoteSell include wrapper fees but do not fully model transfer taxes. For Tax Token V3 read [tax ABI](../../abis/flap/tax-token.json): state(), mainPool(), buyTaxRate(), sellTaxRate(). Require mainPool=verified pair. State 2/3 permits taxed pool transfers; 4 is tax-free. Other states require an updated route. V3 tax applies to pool transfers; ordinary wallet↔wrapper transfer is not an additional pool trade. Do not generalize this to arbitrary tokens.

Compute integer amounts in execution order:

- Buy: Wrapper.previewFees(grossBnb).amountAfterFees → Router.getAmountsOut([WBNB,token]) → subtract current pool buy tax using token rounding → Wrapper.previewTokenFee(token,receivedToken).amountAfterFee.
- Sale: Wrapper.previewTokenFee(token,grossToken).amountAfterFee → subtract pool sell tax from pair input → Router.getAmountsOut([token,WBNB]) → Wrapper.previewFees(grossBnbOut).amountAfterFees.

Use actual wrapper preview getters for native / registered-community token fees, once each. A spot reserve ratio is not an amount quote. Automatic tax liquidation can change reserves during execution; the complete final transaction must simulate and enforce the final net delivery minimum. Failure is not permission to widen slippage.

## Execution and delivery

Use the full wrapper ABI and [call cards](../imported-token-swap-wrapper.md). from=wallet; buy value=gross BNB wei; sell value=0; recipient=wallet; quote/execution sourceType/data must match; deadline is Unix seconds; sellsman=zero unless explicitly verified attribution was requested.

Approve **Wrapper**, not Router, for a finite sale amount, resetting a nonzero insufficient allowance separately if needed. After approval receipts refresh the trade preview. Confirmation applies to its exact requestId.

Buy delivery comes from actual recipient token transfers. For a sale require matching ImportedTokenTrade trader/token/sourceType/keccak256(sourceData)/recipient/direction; netNativeAmount records net BNB delivery. Theoretical estimates are not receipt evidence.

## Other pools and direct fallback

The [migration guide](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/token-migration) distinguishes V2/V3 pool addresses from compatibility fields. Infinity LaunchedToDEX.pool can mean Vault and Uniswap v4 can mean PoolManager. Resolve FlapTokenCLPoolCreated.poolId and verify complete PoolKey, manager, hooks, fee and liquidity; do not treat those addresses as pairs.

Direct fallback requires proven wrapper incompatibility **and an implemented verified Uniswap/Pancake adapter**. Unsupported taxed V3 inputs, a hook requiring nonempty data or an unimplemented source type may establish it. RPC errors, stale quotes, risk blocks, missing approvals or balance do not. The runner does not silently change venues.

ERC20 settlement Q needs a verified complete BNB↔Q bridge and actual-output recovery. Until integrated, display price in Q and explain the missing conversion route only if trading is requested. Do not spend old Q holdings silently or report Q as BNB.
