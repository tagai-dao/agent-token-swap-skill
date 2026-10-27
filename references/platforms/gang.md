# GANG Queries and Trading

Read the matching [call example](../gang/worked-examples.md) first. Use existing HTTP / ABI / RPC and Binance wallet tools; no checkout, npm install or GANG CLI install is required. Fetch the [deployment registry](../../config/gang-bsc.json), [source evidence](../../config/gang-source-evidence.json) and required JSON ABIs individually.

## Resolve and identify

For a ticker call `GET https://gang.fun/api/search?q=<URL-encoded-ticker>`. The result is an array with `address`, `name`, `symbol`, `chainId`, `track` and `quoteAddress`. Filter BSC, prefer case-insensitive exact symbols and deduplicate addresses. List ambiguous matches for selection. API track and quoteAddress are hints; prove issuance on chain.

For a supplied address, retain that address. For `https://gang.fun/token/<address>`, extract its path address. Search is unnecessary for either input. Pin snapshot B and use Multicall3.aggregate3 for all contract read batches, including dependent phases and retries. Include every registered pad's `curves(token)` in the integrated issuer proof batch. A nonzero creator identifies that pad; multiple matches, failed required proofs or missing state stop classification. An empty DEX pair does not disprove an internal market.

| Pad in registry | ABI | curves return fields in order | Internal execution |
| --- | --- | --- | --- |
| Current V2 | [v2.json](../../abis/gang/v2.json) | creator, quote, raised, sold, gradAmt, virtualQuote, graduated, taxed, pair, refPair | ERC20 buy/sell below |
| Main / Soft archive | [soft.json](../../abis/gang/soft.json) | creator, raised, sold, graduated, pair | Native BNB buy/sell below |
| U archive | v2-shaped | Same ten fields as V2 | Query only; its tax split rounding differs |
| S archive | [s.json](../../abis/gang/s.json) | creator, quote, raised, sold, gradAmt, virtualQuote, graduated, pair, refPair | Query only; always taxed, no taxed tuple field |

Verify the matched pad's runtime hash, token.launchpad() binding, name(), symbol(), decimals() and locked(). A graduated token must be unlocked and have a verified liquid pair before external execution. Read walletRoom(token,wallet), balanceOf(wallet), MAX_PER_WALLET() and isAgent(wallet) for wallet-specific trading.

## Information and quotes

Internal reference price uses the actual quote asset, not an assumed BNB denomination:

- Native pad: `spotPrice(token)` returns 18-decimal BNB per token; target is GRADUATION_BNB().
- Quote pad: `floor((virtualQuote + raised) * 10^18 / (1066666666666666666666666667 - sold))` returns quote base units per token. Read quote.symbol()/decimals(). Progress is `floor(raised * 10000 / gradAmt) / 100` percent.
- External: read token/quote reserves from the verified pair and report their ratio in quote units. BNB amount quotes additionally include the verified conversion route.

Current V2 exposes no quoteBuy/quoteSell view. Calculate from the full pinned curve using the exact integer [calculator](../../scripts/lib/gang-math.mjs), including wallet and graduation caps/refunds. Native Main/Soft use `quoteBuy(token,wallet,grossBnb)` -> `(tokenOut,netBnb,feeBnb,refundBnb)` and `quoteSell(token,tokenIn)` -> `(netBnb,feeBnb)`. Do not call the native quote ABI on V2. A reference price is not an amount-specific execution quote.

## Internal transaction methods

| Market / direction | Contract call | Value | Approval |
| --- | --- | --- | --- |
| Native buy | pad.buy(token,minTokensOut) | Gross user BNB in wei | None |
| Native sell | pad.sell(token,tokenIn,minBnbOut) | 0 | token -> pad |
| Quote buy | pad.buy(token,quoteIn,minTokensOut) | 0 | quote -> pad |
| Quote sell | pad.sell(token,tokenIn,minQuoteOut) | 0 | token -> pad |

All integers are base units. Caller and recipient are the actual wallet. Both internal buys **and sells** require pad.isAgent(wallet)=true, backed by the configured Agent ID registry. Binance connection alone is not this eligibility proof. Keep the wallet's live room and the contract's 10-million-token cap in the quote; never infer room from a global supply number. Preview only finite required approvals; reset nonzero insufficient allowances to zero before a fresh finite approval. Native pad sale can park a failed BNB delivery; a sale event alone is not proof of native receipt.

## BNB settlement and sequential execution

Read curves.quote. Current V2 supports different ERC20 quote assets, not only GANG. Automated conversion is connected for verified WBNB and platform GANG:

| Direction | WBNB settlement | GANG settlement |
| --- | --- | --- |
| Buy | WBNB.deposit{value:bnbIn}() -> pad.buy(token,actualNewWbnb,min) | Wrapper.buyToken(GANG,...) -> pad.buy(token,actualNewGang,min) |
| Sell | pad.sell(token,tokenIn,minWbnb) -> WBNB.withdraw(actualNewWbnb) | pad.sell(token,tokenIn,minGang) -> Wrapper.sellToken(GANG,...,actualNewGang,...) |

Use the [WBNB ABI](../../abis/gang/wbnb.json). V2 buy is nonpayable even when its quote is WBNB. Other ERC20 quotes remain queryable but need an additional verified conversion before BNB execution.

Quote the whole route before its first preview. Split the user's slippage budget over variable-price legs; wrap/unwrap is deterministic. Compute a final minimum through the first leg's worst permitted output and the second leg's budget. Persist the root intent, final floor, exact requestIds and completed receipts. After leg one confirms, use only its actual newly delivered quote-asset amount from verified receipt events. Requote leg two, preserve the original final floor and show its fresh approval/trade preview. Do not spend pre-existing quote balances or substitute a quote for an unknown receipt amount.

The optional runner's `resume --plan <root-id>` advances confirmed approvals and routes. It never broadcasts by itself. A failed/expired second preview may be refreshed with the saved intermediate amount; a confirmed first leg is never repeated. Unknown submission must be reconciled first. A second-leg failure leaves the intermediate asset in the wallet and the route PARTIAL; no automatic reverse trade.

## External routes

Verify the pair's factory, token0/token1, reserves and the factory's getPair binding against Pancake V2; verify the router's factory()/WETH(). Prefer ImportedTokenSwapWrapper with sourceType=0 and `sourceData=abi.encode((PancakeV2Router,pair))`. Verify wrapper/settlement-router identities and configuration. Read previewFees/previewTokenFee in the same snapshot.

For a GANG-quoted pair, additionally verify GANG's own graduated WBNB pair and NutboxRouter.hasRoute(WBNB,GANG). A configured route must match the verified bridge pool/source. If hasRoute=false, that is concrete wrapper incompatibility: use the verified Pancake V2 path `[WBNB,GANG,target]` or its reverse with the SupportingFeeOnTransferTokens router method. Unknown RPC errors or unimplemented verification are not incompatibility.

Taxed graduated tokens additionally require verified token.pair(), taxHandler(), OUTER_TAX_BPS() and endpoint isExcluded() reads. The pinned token implementation taxes pool transfers at 100 bps when neither endpoint is excluded and the handler is nonzero. Apply the fee at the actual pool transfer, then wrapper fees where applicable. No wallet means no assumed exemption. Verify all supported code/pool/quote bindings before simulation; other DEX protocols are not implicitly supported.

## Evidence and coverage

The registry and [worked observations](../../config/gang-worked-examples.json) include Main/Soft/V2 identities, U/S query layouts, live internal GANG settlement, native archive trades and external WBNB/GANG pools. Read-only full-call simulations passed for sampled BNB-funded wrapper conversion, external direct routing and native buying. Dependent second legs require actual intermediate delivery and approval before real-wallet simulation; no development trades were sent. U/S internal execution and other quote-asset bridges remain unconnected. Keep these adapter details internal and report only the requested token's concrete outcome or blocker.

Primary sources: [GANG guide](https://gang.fun/docs), [LaunchpadV2 source](https://github.com/gangfun/gang-launchpad/blob/bad314210a1fa9a10ee3f760ddb3bc11b1c68870/src/launchpad-v2/LaunchpadV2.sol), [mainnet references](https://github.com/gangfun/gang-launchpad/blob/bad314210a1fa9a10ee3f760ddb3bc11b1c68870/config/MainnetAddresses.sol), [official CLI ABI](https://github.com/gangfun/cli/blob/8479a24f2628397999560958ee20aa6940a5c545/src/abi.js).
