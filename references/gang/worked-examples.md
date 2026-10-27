# GANG Call Examples

Use the matching recipe with existing HTTP, ABI, RPC and Binance wallet tools. No clone, dependency install or GANG CLI is required. [Routing](../platforms/gang.md) supplies deployment and eligibility checks. These are historical BSC read-only observations from 2026-10-27; refresh state and deadlines for a real preview. Complete encoded calldata and decoded arguments for eight buy/sell cases are in [observations](../../config/gang-worked-examples.json).

## Addresses and units

| Name | Address / value |
| --- | --- |
| V2 pad P | 0x1B8F3f69DFa0a7F63d308C7EB0Fd38D8b099966E |
| Native Main pad N | 0x315Ba2e8952D06094CC636b2B84229FA32fb23A7 |
| Platform GANG Q | 0x0c6302401aa5325C2E36F170f52C00B1d220B405 |
| Internal gangster T | 0x0059a88c12c49fF30dD1637d6d0C695eD52010c9 |
| Graduated Gangstar X | 0x6b2CE31a577D92f73516c7A91FEBC7672247e694 |
| Native archive token H | 0x1f5BBf5d8AbEF0a8cD3Ff6ae111Fb3bdAb85e0f5 |
| WBNB W | 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c |
| Pancake V2 Router R | 0x10ED43C718714eb63d5aA57B78B54704E256024E |
| Pancake V2 Factory F | 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73 |
| GANG/WBNB pair B | 0x0bd5dEd695d61C2db15C703c345D57e039FD0b6D |
| Gangstar/GANG pair C | 0xB61C41f8b334D183c4C22c026e9D35F363113330 |
| ImportedTokenSwapWrapper I | 0xDfFc699FB095a693708E3c15e6F0a224cbbCc98F |
| NutboxRouter NR | 0x04e2d43bA38e3f3F0D0dab3A30D1B58BFE9B659f |
| Multicall3 M | 0xcA11bde05977b3631167028862bE2a173976CA11 |
| Sample wallet A | 0x8EEc229385A366F0FF2F88Db27F428B8A7343c08 |
| Zero Z | 0x0000000000000000000000000000000000000000 |

A is a public simulation sample, not the user's wallet. Replace it with the owned BSC wallet for execution. Sample tokens and quote assets have 18 decimals: 0.001 BNB=1000000000000000 wei; 1000 tokens=1000000000000000000000 raw units. D is a fresh Unix deadline, e.g. current time+180 seconds. S is ABI encoding of `(address router,address pair)=(R,B)` as one static tuple:

```text
0x00000000000000000000000010ed43c718714eb63d5aa57b78b54704e256024e0000000000000000000000000bd5ded695d61c2db15c703c345d57e039fd0b6d
```

Use [V2 ABI](../../abis/gang/v2.json), [native ABI](../../abis/gang/soft.json), [token/ERC20 ABI](../../abis/erc20.json), [DEX/route views](../../abis/gang/dex.json), [wrapper ABI](../../abis/imported-token-swap-wrapper.json), [Pancake ABI](../../abis/tagai/pancake.json) and [Multicall ABI](../../abis/multicall3.json).

## 1. Find a ticker or query an address

User: "Check gangster's price."

```http
GET https://gang.fun/api/search?q=gangster
```

Decode the returned array; match symbol case-insensitively, filter chainId=56 when present, and deduplicate address. If multiple exact addresses remain, list them for selection. Without a user-specified platform, also search other integrated indexes and disclose failed index coverage. The live lookup returned these exact-symbol candidates in platform response order; select the address before a trade:

| Symbol | Address |
| --- | --- |
| gangster | 0x0059a88c12c49fF30dD1637d6d0C695eD52010c9 |
| GANGSTER | 0x4cd5f2e857dc90CaE0BF36cA5695AE525D27AFaE |
| GANGSTER | 0xC7450e49D64AE77552Acdb18937892082D1787e7 |

The following cases use the first explicitly selected address T. A supplied T or `https://gang.fun/token/0x0059a88c12c49fF30dD1637d6d0C695eD52010c9` skips ticker search.

Pin one numeric blockTag. Build `M.aggregate3([(pad,true,encode(curves,[T])), ...])` for every pad in [the registry](../../config/gang-bsc.json), with each pad's ABI. Include the other integrated platform proofs when the platform is unknown. Decode in order; require successful GANG proofs before excluding a pad. P returned the following at block 0x7c02cee, 2026-10-27T05:39:16Z:

```text
curves(T) ->
creator      = 0xfDa4A63EBF833e8cbb69A0C4BA327E5695B1d44A
quote        = Q
raised       = 474735423895605095116940
sold         = 285705024029876711463050880
gradAmt      = 3893002838038450105901943
virtualQuote = 1297667612679483368633981
graduated    = false
taxed        = false
pair         = Z
refPair      = B
```

Next Multicall, same block: `T.name()`, `T.symbol()`, `T.decimals()`, `T.launchpad()`, `T.locked()`, `P.MAX_PER_WALLET()`, `P.walletRoom(T,A)`, `P.isAgent(A)`. Read `Q.symbol()`/`Q.decimals()` in a dependent Multicall at that same block. Verify P's runtime hash from the registry. Reads without a wallet use zero-address room for a theoretical quote and omit eligibility checks.

```text
name/symbol = gangster; decimals=18; launchpad=P; locked=true
priceRaw = floor((1297667612679483368633981 + 474735423895605095116940)
                 * 1000000000000000000
                 / (1066666666666666666666666667 - 285705024029876711463050880))
         = 2269513558426324
progress = floor(474735423895605095116940 * 10000 / 3893002838038450105901943) / 100
         = 12.19%
```

Return gangster, full address T, GANG, internal market, **0.002269513558426324 GANG per token**, progress and timestamp. No wallet login or external-pool discovery is needed for this information query.

## 2. Buy gangster with 0.001 BNB

User: "Buy 0.001 BNB of gangster."

The selected token is T, curve settlement=Q, so quote BNB -> Q -> T. Read `P.isAgent(A)=true`, live `P.walletRoom(T,A)`, and the wallet's balances. Use 50 bps per variable-price leg for a total 100 bps budget.

At the section 1 snapshot, get the first quote through same-block Multicalls:

| Target | Method / arguments | Use |
| --- | --- | --- |
| I | previewFees(1000000000000000) | amountAfterFees is the Router input |
| R | getAmountsOut(amountAfterFees,[W,Q]) | Last amount is GANG before wrapper token fee |
| I | previewTokenFee(Q,lastAmount) | amountAfterFee=115147587103057896296 |

Verify B using its factory(), token0(), token1(), getReserves(), plus `F.getPair(W,Q)`, `R.factory()` and `R.WETH()`. First transaction:

```text
to=I; from=A; valueWei=1000000000000000
buyToken(Q,0,S,114571849167542606814,A,D,Z)
```

Parameters: token=Q, sourceType=0 (Pancake V2), sourceData=S, minTokensOut in Q base units, recipient=A, deadline=D, subject=Z. Expected first output=115.147587103057896296 GANG.

For the second quote, the current pad has no quoteBuy method. Use the exact [integer calculator](../../scripts/lib/gang-math.mjs) with the curve above:

```text
gangBuy(curve,115147587103057896296,liveWalletRoom).output
  = 50226084511609411893418
second minimum at 50 bps = 49974954089051364833950
gangBuy(curve,114571849167542606814,liveWalletRoom).output * 9950 / 10000
  = 49725095308487703727166  // persisted whole-route floor
```

The normal uncapped calculation is `net=gross-floor(gross/100)`, `k=virtualQuote*1066666666666666666666666667`, `out=1066666666666666666666666667-sold-ceil(k/(virtualQuote+raised+net))`. For caps/refunds use the complete calculator, not the normal branch alone.

Preview the full BNB budget, expected **50226.084511609411893418 gangster**, minimum **49725.095308487703727166 gangster**, included fees, separate gas and the two steps. Preview/confirm/send leg one. After its confirmed receipt, derive `receivedQ` only from Q transfers delivered by this route. If it equals the sample expected output:

```text
Q.allowance(A,P)                         // Multicall at fresh pinned block
Q.approve(P,115147587103057896296)         // if needed: finite separate preview
P.buy(T,115147587103057896296,49974954089051364833950)
from=A; valueWei=0
```

`quoteIn` is gross Q base units and `minTokensOut` is raw T. Refresh the curve and minimum after actual delivery / approval; preserve at least the persisted whole-route floor. Simulate and preview P.buy only once funds and allowance exist. Confirm that new preview, send once and verify T delivery. A different receipt amount replaces the sample input; pre-existing GANG is not added.

## 3. Sell 1000 gangster back to BNB

Same token T. At block 0x7c02cf4:

```text
tokenIn = 1000000000000000000000
gangSell(curve,tokenIn).output = 2246815545856274145 Q
first minQuoteOut = 2235581468126992774
T.approve(P,1000000000000000000000)   // only if needed
P.sell(T,1000000000000000000000,2235581468126992774)
from=A; valueWei=0
```

The normal calculation is `gross=virtualQuote+raised-ceil(virtualQuote*1066666666666666666666666667/(1066666666666666666666666667-sold+tokenIn))`, `net=gross-floor(gross/100)`. The pad checks Agent ID for this sale too.

For Q -> BNB, read `I.previewTokenFee(Q,receivedQ)`, `R.getAmountsOut(amountAfterFee,[Q,W])`, then `I.previewFees(lastAmount)` at the next pinned snapshot. Expected complete route output=19188811249327 wei BNB; persisted final floor=18997402865460 wei. After actual first receipt and fresh quote, if receivedQ equals the sample:

```text
Q.approve(I,2246815545856274145)   // only if needed
I.sellToken(Q,0,S,2246815545856274145,19092867193080,A,D,Z)
from=A; valueWei=0
```

Parameters: amountIn is Q base units; minNativeOut is net BNB wei. Both approval and sale have separate exact previews. Verify the wrapper's matching ImportedTokenTrade event and native delivery; do not report the estimated BNB as actual before confirmation.

## 4. WBNB-settled internal token

For another token U with a proved current-pad record whose quote=W:

```text
W.deposit()                                 // valueWei=1000000000000000
W.approve(P,actualNewWbnb)                   // finite, if needed
P.buy(U,actualNewWbnb,freshMinTokensOut)      // valueWei=0
```

Use [WBNB ABI](../../abis/gang/wbnb.json). Deposit(dst=A,wad=...) from W establishes the newly wrapped amount. For a sale:

```text
U.approve(P,tokenIn)                         // if needed
P.sell(U,tokenIn,freshMinWbnbOut)             // valueWei=0
W.withdraw(actualNewWbnb)                    // valueWei=0
```

The second amount is only net W transfers from that pad sale receipt. Withdraw returns BNB one-for-one and emits Withdrawal(src=A,wad=...). These are parameterized methods; section 2's live token T uses GANG, so do not deposit WBNB for T.

## 5. Native archive token: on-chain quotes and direct BNB

Selected token H, issuer N. Use the native ABI, not P's three-argument buy:

```text
N.quoteBuy(H,A,1000000000000000)  // Multicall; output[0]=154743674507648963075453
N.buy(H,153196237762572473444698)
from=A; valueWei=1000000000000000
```

Observed at block 0x7c02d07. quoteBuy returns `(tokensOut,bnbIn,fee,refund)`; bnbIn is net curve input. The full buy call passed read-only simulation.

```text
N.quoteSell(H,1000000000000000000000)  // Multicall; output[0]=6332764353682
H.approve(N,1000000000000000000000)    // if needed
N.sell(H,1000000000000000000000,6269436710145)
from=A; valueWei=0
```

Observed sale quote at block 0x7c02d0a. quoteSell returns `(netBnb,fee)`. Both directions check N.isAgent(A). Verify actual native delivery separately; a deferred payout is not realized BNB.

## 6. Buy/sell platform GANG through the wrapper

Q is itself graduated, with verified pair B. At block 0x7c02ce6, 0.001 BNB quotes 115121768254644782213 raw Q:

```text
I.buyToken(Q,0,S,113970550572098334390,A,D,Z)
from=A; valueWei=1000000000000000
```

For a 1000 GANG sale, block 0x7c02cea:

```text
Q.approve(I,1000000000000000000000)   // if needed
I.sellToken(Q,0,S,1000000000000000000000,8454028498043216,A,D,Z)
from=A; valueWei=0
```

Expected sale output=8539422725296178 wei BNB. Quote calls and argument meanings are the same as the settlement leg above; use a fresh snapshot for each actual request.

## 7. Graduated Gangstar: verified direct Pancake fallback

X is graduated with quote=Q and pair C. Verify C and B against F and R. In the sampled deployment `NR.hasRoute(W,Q)=false` and `routePoolCount(W,Q)=0`, so the wrapper cannot bridge this target's quote asset. Use R directly with the proved two-hop path. If a future verified bridge is configured, prefer the wrapper instead; follow [route verification](../platforms/gang.md).

```text
R.getAmountsOut(1000000000000000,[W,Q,X])   // same-block Multicall
  -> last=3276472867648983296550
R.swapExactETHForTokensSupportingFeeOnTransferTokens(
  3243708138972493463584,[W,Q,X],A,D)
from=A; valueWei=1000000000000000
```

Observed at block 0x7c02cfc; the full call passed read-only simulation. No ERC20 approval for this BNB buy. For a 1000 Gangstar sale at block 0x7c02d02:

```text
R.getAmountsOut(1000000000000000000000,[X,Q,W])
  -> last=292165816913484
X.approve(R,1000000000000000000000)   // if needed
R.swapExactTokensForETHSupportingFeeOnTransferTokens(
  1000000000000000000000,289244158744349,[X,Q,W],A,D)
from=A; valueWei=0
```

`amountOutMin` is final token raw output for buys and BNB wei for sales. For taxed tokens, apply the actual verified pool transfer tax to the quote as described in [GANG routing](../platforms/gang.md). X is not taxed in these observations.

## 8. Wallet calls and recovery

Encode the selected ABI and arguments, then decode-check target, value, recipient, units and minimum. Run one full `eth_call` from the actual wallet, estimate gas and check BNB. Use the connected wallet's preview schema or existing CLI:

```bash
baw contract-call preview --binanceChainId 56 --from <owned-wallet> --to <verified-target> --value <wei> --inputData <encoded-call> --json
# After the user confirms that exact successful, unexpired preview:
baw contract-call execute --requestId <saved-request-id> --json
```

Save the route and exact requestId before sending. Each newly quoted transaction needs its own displayed preview and confirmation. Check pending/App states, canonical receipts and actual output. Unknown submission means reconcile, not resend. A failed second leg leaves Q/WBNB in the wallet; resume with that saved amount and original final floor. Do not repeat the first trade or silently swap back.

With an existing checkout the optional equivalent is `prepare --platform gang ...`, `execute --plan <root-id> --confirmed`, `status --plan <root-id>`, then `resume --plan <root-id>` for the next preview. Resume never broadcasts. Development observations used no wallet connection, signing or real trades; dependent second legs were quoted/encoded, not claimed as live executed transactions.
