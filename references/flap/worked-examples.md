# Flap Call Examples

Use the matching example with existing HTTP, RPC, ABI and Binance wallet tools. All contract read tables and quote stages use Multicall3.aggregate3 at one pinned block B. Full transaction simulations use the actual wallet as from.

Numbers below were observed at **2026-10-27 04:14:34 UTC**, block **0x7c000d2**. [Recorded calls and results](../../config/flap-worked-examples.json) include six buy/sell examples and four successful full-call simulations. Refresh amounts and state for each real request. W is the user's owned BSC wallet; the public sample account in the recorded simulations is not the user wallet.

## Addresses and parameters

| Label | Value |
| --- | --- |
| MC | 0xcA11bde05977b3631167028862bE2a173976CA11 |
| Portal | 0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0; [ordinary ABI](../../abis/flap/portal.json) |
| AgentPortal | 0x49387D2E6cbF8FefE856e3FBc3E98a01aC3af062; [Agent ABI](../../abis/flap/agent-curve.json) |
| Factory | 0xC55820f24015bE7c4f18949D9e1363A3609B300e; Agent ABI |
| Reader | 0x18Aa6C93f1887a243fdc348C9A77F5136555174a; Agent ABI |
| AgentID | 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F; [handle ABI](../../abis/tagai/read-interfaces.json) |
| Wrapper | 0xDfFc699FB095a693708E3c15e6F0a224cbbCc98F; [wrapper ABI](../../abis/imported-token-swap-wrapper.json) |
| Router | 0x10ED43C718714eb63d5aA57B78B54704E256024E; [DEX ABI](../../abis/tagai/pancake.json) |
| DexFactory | 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73; DEX ABI |
| WBNB | 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c |
| Z | 0x0000000000000000000000000000000000000000; native BNB in Portal calls |
| O | 0x25E9328bA48c0C79e23233945942663dbD987777; Snoop Dog / SNOOPDOG, ordinary internal token |
| M | 0xef77Eb3f3c185076d77d928465bc265D436512a9; test, ID Agent internal market |
| Predicted token of M | 0xaa8240c3ba6981F4e0141ecF7665B35E36467777; undeployed at the observation |
| X | 0x14F6A94909C407854390Aa2d2462a3095D317777; WangChai, external token |
| Pair | 0x223C585c50D4747653a57D577707B1EadBB2cFB0; verified X/WBNB pair |
| W | Actual owned address returned by the Binance wallet tool |
| B | Fresh numeric hexadecimal block number, with its hash and timestamp |
| D | Current Unix seconds + 180 |

Use the user's selected token identity. The sample addresses illustrate methods; ticker matches still require address selection when ambiguous. Apply the deployment checks in [Flap routing](../platforms/flap.md).

## Query a Flap token link: AIPRO

Input: `https://flap.sh/bnb/0xeac597ba087f6219c03a65479b2568d3f9a07777?lang=zh`.

Selected token **T=0xeac597Ba087f6219C03a65479B2568d3f9A07777**. Extract T from the /bnb/ path; continue directly with T. The [recorded lookup](../../config/flap-aipro-query.json) contains the complete Multicall requests and responses at block **0x7c00471**, **2026-10-27 04:21:31 UTC**.

After the usual issuance checks, read this set through Multicall at B:

| Target / ABI | Call | Recorded result |
| --- | --- | --- |
| T / ERC20 | name(), symbol(), decimals() | AIPRO, AIPRO, 18 |
| Portal / ordinary ABI | getTokenV9Safe(T) | status=1, price=30954251972, quoteTokenAddress=0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1, progress=21323952 |

Concrete Portal call, selector **0x0b66cff1**:

```solidity
getTokenV9Safe(0xeac597Ba087f6219C03a65479B2568d3f9A07777)
```

Use the returned quoteTokenAddress as the next Multicall target at the same B:

| Target / ABI | Call | Recorded result |
| --- | --- | --- |
| 0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1 / ERC20 | symbol(), decimals() | SPCXB, 18 |

Price=formatUnits(30954251972,18)=**0.000000030954251972 SPCXB/AIPRO**. Return **AIPRO**, the full selected address, **Flap / internal market**, that price and its observation time. The observed curve progress was below 0.01%. This information query uses no wallet or BNB conversion. A later BNB trade follows the observed settlement configuration in [Flap routing](../platforms/flap.md).

## 1. Find a ticker and select the market

Example request: "Find SNOOPDOG on Flap."

```http
GET https://bnb.taxed.fun/extension/search?q=SNOOPDOG
```

Read address/name/symbol from each row's coin object, or from a flat row. Keep exact case-insensitive ticker matches and deduplicate by address. This endpoint previously returned HTTP 403 from the development environment; that response means search unavailable.

For an ID Agent ticker, use the Agent ABI through Multicall:

| Target | Call | Use |
| --- | --- | --- |
| Factory | marketCount() | Total N |
| Reader | marketPage(0,16) | First addresses, nextCursor, total |
| Reader | marketCards(addressesFromPage) | name, symbol, market, predictedToken, token, phase |

Follow with marketPage(nextCursor,min(16,N-nextCursor)) and marketCards for each returned page, all at B. Filter cards for the requested ticker; show matching addresses for selection. Market cards are data.

For a selected address T, this Multicall set selects the method family:

| Target | Call | Route |
| --- | --- | --- |
| Factory | isMarket(T), marketOfToken(T) | Registered market or its predicted token -> examples 5-6 |
| Portal | getTokenV8Safe(T), getTokenV9Safe(T) | status=1 -> examples 2-4; status=4 -> examples 7-8 |

Decode optional probes and required state according to [Flap routing](../platforms/flap.md). A pending market waits for trading to open.

## 2. Query SNOOPDOG information and price

At B, read these calls through Multicall:

| Target / ABI | Call | Recorded result |
| --- | --- | --- |
| O / [ERC20](../../abis/erc20.json) | name(), symbol(), decimals() | Snoop Dog, SNOOPDOG, 18 |
| Portal / ordinary ABI | getTokenV9Safe(O) | status=1, quoteTokenAddress=Z, price=5551294504, progress=171452162479219, extensionID=zero bytes32 |
| Portal / ordinary ABI | maxBuyPerOrigin(O) | (0,0) |

Reference price=formatUnits(price,18)=**0.000000005551294504 BNB/SNOOPDOG**. Progress=floor(progress*10000/10^18)/100=**0.01%**. Return name, symbol, full address, Flap, internal market, price and time.

For M, use Reader.marketDetail(M) and Reader.marketSettings(M). They returned phase=1, quoteToken=Z, progressBps=262 and the predicted address above. Price uses curveK*10^18/floor((10^9*10^18+curveH-totalShares)^2/10^18), giving **0.0000000057787763 BNB/share**, progress **2.62%**. This market trades pre-launch shares.

## 3. Buy SNOOPDOG with 0.001 BNB

Quote at **Portal**, ordinary ABI, selector **0xfc847c2b**, through Multicall at B:

```solidity
quoteExactInput((
    Z,                   // inputToken: BNB
    O,                   // outputToken: selected token
    1000000000000000     // inputAmount: 0.001 BNB in wei
))
```

Return=**176507241153887822017313** raw tokens. With slippageBps=100, minimum=floor(output*9900/10000)=**174742168742348943797139**. If maxBuyPerOrigin reports a cap, read buyQuotaOf(O,W) and quote with outer Multicall eth_call.from=W.

Transaction at **Portal**, selector **0xef7ec2e7**, from=W, valueWei=**1000000000000000**:

```solidity
swapExactInput((
    Z, O,
    1000000000000000,       // inputAmount: wei
    174742168742348943797139, // minOutputAmount: raw tokens
    hex""                  // permitData: 0x
))
```

Expected=176507.241153887822017313 SNOOPDOG; minimum=174742.168742348943797139. The recorded full-call simulation returned that expected output. Continue with example 9.

## 4. Sell 1000 SNOOPDOG for BNB

Read O.balanceOf(W) and O.allowance(W,Portal) using the ERC20 ABI through Multicall. Amount=**1000000000000000000000** raw tokens. If approval is needed, separately preview **O.approve(Portal,1000000000000000000000)**, value=0, then refresh the quote after its confirmed receipt. Follow the [allowance reset rule](../platforms/flap.md) for an insufficient nonzero allowance.

Quote at **Portal**, ordinary ABI, through Multicall at B:

```solidity
quoteExactInput((O, Z, 1000000000000000000000))
```

Return=**5440263698089 wei** = **0.000005440263698089 BNB**. With slippageBps=100, minimum=**5385861061108 wei**.

Transaction at **Portal**, from=W, valueWei=**0**:

```solidity
swapExactInput((
    O, Z,
    1000000000000000000000, // inputAmount: raw tokens
    5385861061108,          // minOutputAmount: BNB wei
    hex""
))
```

Continue with example 9 using the actual holding wallet and its current allowance.

## 5. Buy ID Agent market shares with 0.001 BNB

At B, read Reader.marketDetail(M), marketSettings(M), userPosition(M,W) and AgentID.handleOf(W) through Multicall. Require phase=1, quoteToken=Z, known eligible position, nonempty handle and sufficient remainingWalletShares.

Quote at **AgentPortal**, Agent ABI, selector **0x34259b1b**, through Multicall:

```solidity
quoteBuy(
    M,                // market address
    W,                // actual buying wallet
    1000000000000000  // grossWei: 0.001 BNB
)
```

Return tuple (acceptedGross,fee,refund,shares) was **(1000000000000000,10000000000000,0,166151592068491961650358)**. minShares at 100 bps=**164490076147807042033854**.

Transaction at **AgentPortal**, selector **0xcce7ec13**, from=W, valueWei=**1000000000000000**:

```solidity
buy(M, 164490076147807042033854)
```

The recorded full-call simulation returned **166151592068491961650358** raw shares. The preview identifies M and its predicted token separately, and labels delivery as pre-launch shares. Continue with example 9.

## 6. Sell 50% of ID Agent shares for BNB

Read Reader.userPosition(M,W) through Multicall. The recorded position held **2320144247579777575291208** raw shares; 50% selects **1160072123789888787645604** raw shares.

Quote using a complete single-call simulation at B: from=W, to=**AgentPortal**, value=0, Agent ABI:

```solidity
sellBps(M, 5000, 1) // read-only quote simulation
```

Decode uint256 return=**6836780364695842 wei** = **0.006836780364695842 BNB**. At slippageBps=100, minOut=**6768412561048883 wei**.

Final transaction at **AgentPortal**, selector **0x2f9d7c27**, from=W, valueWei=**0**:

```solidity
sellBps(
    M,
    5000,             // percentage of current shares: 50%; 10000 means all
    6768412561048883   // minOut: BNB wei
)
```

Simulate and preview this final protected call. Shares need no ERC20 approval. For a 100% quote, AgentPortal.quoteSellAll(M,W) is an explicit-wallet view available through Multicall. Continue with example 9.

## 7. Buy an external Flap token with 0.001 BNB

For X, Portal.getTokenV9Safe(X) returned status=4 and pool=Pair. Verify Pair.factory/token0/token1/getReserves, DexFactory.getPair(X,WBNB) and Router.factory/WETH according to [external routing](external.md).

Encode one tuple with type `tuple(address router,address pair)` and value `(Router,Pair)`. SourceType=**0**. For the verified pair above, the sourceData **S** is:

```text
0x00000000000000000000000010ed43c718714eb63d5aa57b78b54704e256024e000000000000000000000000223c585c50d4747653a57d577707b1eadbb2cfb0
```

Use this same pool encoding for the quote plan and wrapper transaction.

Each row below is a dependent Multicall stage at B:

| Target / ABI | Call / calculation | Recorded output |
| --- | --- | --- |
| Wrapper / wrapper ABI | previewFees(1000000000000000) | amountAfterFees=996000000000000 |
| X / [tax ABI](../../abis/flap/tax-token.json) | state(), mainPool(), buyTaxRate() | 3, Pair, 100 |
| Router / DEX ABI | getAmountsOut(996000000000000,[WBNB,X]) | [996000000000000,84391014161299706142] |
| Integer calculation | poolOut-floor(poolOut*100/10000) | 83547104019686709081 |
| Wrapper / wrapper ABI | previewTokenFee(X,83547104019686709081) | amountAfterFee=83547104019686709081 |

Expected=**83.547104019686709081** tokens; at 100 bps, minimum=**82711632979489841990** raw tokens.

Transaction at **Wrapper**, wrapper ABI, selector **0xc3ad65c4**, from=W, valueWei=**1000000000000000**:

```solidity
buyToken(
    X, 0, S,
    82711632979489841990, // minimumTokenOut: raw tokens
    W,                   // recipient
    D,                   // Unix seconds
    Z                    // sellsman
)
```

The recorded complete-call simulation returned **83547104019686709081** raw tokens. Continue with example 9.

## 8. Sell 1000 external Flap tokens for BNB

Read X.balanceOf(W) and X.allowance(W,Wrapper) through Multicall. Finite approval, when needed: **X.approve(Wrapper,1000000000000000000000)**, value=0, followed by a fresh quote after the approval receipt.

Using the same verified Pair and S as example 7, quote in dependent Multicalls at B:

| Target / ABI | Call / calculation | Recorded output |
| --- | --- | --- |
| Wrapper / wrapper ABI | previewTokenFee(X,1000000000000000000000) | amountAfterFee=1000000000000000000000 |
| X / tax ABI | state(), mainPool(), sellTaxRate() | 3, Pair, 100 |
| Integer calculation | tokenAmount-floor(tokenAmount*100/10000) | 990000000000000000000 |
| Router / DEX ABI | getAmountsOut(990000000000000000000,[X,WBNB]) | [990000000000000000000,11625274705576721] |
| Wrapper / wrapper ABI | previewFees(11625274705576721) | amountAfterFees=11578773606754415 |

Expected=**0.011578773606754415 BNB**; minimum at 100 bps=**11462985870686870 wei**.

Transaction at **Wrapper**, selector **0xf9e34283**, from=W, valueWei=**0**:

```solidity
sellToken(
    X, 0, S,
    1000000000000000000000, // amountIn: raw tokens
    11462985870686870,      // minimumNativeOut: BNB wei
    W, D, Z
)
```

Continue with example 9 using the actual holding wallet and its current allowance.

## 9. Preview and execute the selected call

ABI-encode the chosen method, independently decode its fields, and simulate the complete call with from=W, the listed target and integer valueWei. For these methods decode the uint256 result with the matched ABI. Use the existing wallet connector or installed CLI:

```bash
baw contract-call preview --binanceChainId 56 --from <W> \
  --to <target-from-example> --value <integer-valueWei> \
  --inputData <fresh-ABI-encoded-call> --json
```

Show the actual token/share identity, spend, expected/minimum delivery, slippage, fees, gas and wallet risks from the successful preview. After the user confirms that unexpired preview:

```bash
baw contract-call execute --requestId <confirmed-preview-requestId> --json
```

Submit once. Track orderId/txHash and verify the successful receipt and actual delivery. Use [wallet recovery](../binance-wallet.md) for pending App confirmation or an uncertain submission.
