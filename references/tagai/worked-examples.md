# TagAI Worked Examples: Lookup, Quote, Buy and Sell

Follow the matching numbered recipe. Use existing HTTP / JSON-RPC, ABI encoding / decoding and Binance wallet tools. A clone, npm install, repository script, or new SDK is not required. All contract read sets below go through **Multicall3.aggregate3** at one pinned block, never independent eth_call loops or a JSON-RPC batch. Full actual-wallet transaction simulation is a separate single eth_call.

The numerical observations below were collected on **2026-10-27 at 04:07:24 UTC**, block **0x7bffd17** (hash 0xc5a1fe4d8ccad08b4302fc85873994a4b76db5afbbe6726c1661e0d6010c03c9). They are historical test vectors, **not current quotes or permission to trade**. [Structured observations](../../config/tagai-worked-examples.json) contain exact raw quantities, ABI-decoded transactions, calldata and read-only simulation results. Re-run every relevant read and quote for a real request. Use the user's owned wallet, never the public account used for those read-only simulations.

## Choose the recipe

| User request | Required sequence |
| --- | --- |
| "Check TTAI's token information / price" | 1 → 2; show both exact-name candidates if still present; no wallet required |
| "What does 0.001 BNB buy in TTAI?" | 1 → select address if ambiguous → 2 → 3; quote only |
| "Buy TTAI with 0.001 BNB" | 1 → select address if ambiguous → 2 → 3 → 4; confirmation authorizes only the displayed preview |
| "Sell 1000 TTAI" | 1 → select address if ambiguous → 2 → 5 |
| "Buy AIPRO with 0.001 BNB" | Resolve and prove its current address → 6 → 4's wallet flow with the internal transaction |
| "Sell 1000 AIPRO" | Resolve and prove its current address → 7 → 4's wallet flow with the internal transaction |

Do not choose an asset from capitalization, age, liquidity, price or the apparent simplicity of its route. The user's selection resolves an ambiguous address; it is not trade confirmation. If an address was already supplied or explicitly selected in this conversation, reuse that selected identity and reverify its state. If state changed, use the corresponding current-market instructions; never force an old example onto a different token or ignore a user-specified route.

## Shared addresses, ABIs and variables

| Label | Address / source |
| --- | --- |
| MC | 0xcA11bde05977b3631167028862bE2a173976CA11; [aggregate3 ABI](../../abis/multicall3.json) |
| TTAI | 0x8e11E90B463bf521382E2B88539F053270a3848c |
| TTAI Pump | 0xa77253Ac630502A35A6FcD210A01f613D33ba7cD |
| Other exact-name ttai | 0x51B561b3e30E626142A710E5e36da46A7DD124A5 |
| Other ttai Pump | 0x3DC52C69C3C8be568372E16d50E9F3FEc796610c |
| AIPRO | 0xfA81C13f979f0dff4A40B68c4aba147fA0723333 |
| AIPRO Pump | 0x97f35B4631F4FFBF8050B17fAd6579D6F60A289D |
| WBNB | 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c |
| Pancake V2 Factory | 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73 |
| Pancake V2 Router | 0x10ED43C718714eb63d5aA57B78B54704E256024E |
| TTAI/WBNB pair observed | 0xA2e6b0F1E795F9b3E87aA2BDCfCdA0f4A41746C8; reread Factory.getPair |
| Agent ID / handle registry | 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F |
| W | Actual owned BSC wallet returned by the existing Binance wallet tool |
| B | Fresh numeric hexadecimal block number; also store its hash and timestamp |
| G | Exact gross BNB buy budget: 0.001 BNB = **1000000000000000 wei** |
| L | Disclosed user slippage; default **100 bps = 1%** |
| D | Current Unix time in seconds + 180 for the Router deadline |

Read contract interfaces from [ERC20](../../abis/erc20.json), [shared TagAI reads](../../abis/tagai/read-interfaces.json), [DEX](../../abis/tagai/pancake.json), [verified binding getter](../../abis/tagai/token-v16.json), [TTAI Token](../../abis/tagai/token-v1.json) and [AIPRO Token](../../abis/tagai/token-v15.json). [Deployment registry](../../config/tagai-bsc.json) selects the actual ABI after the proof. Internal release IDs are implementation data; do not put them in routine user responses.

For each table row `(target, method, args)`, encode method/args with that row's ABI. Assemble `{target,allowFailure:true,callData}` entries and ABI-encode aggregate3 once. Submit:

```text
eth_call(
  {to: MC, data: ABI_ENCODE(aggregate3, [orderedCalls])},
  B
)
```

Decode every `(success,returnData)` in order and then decode its method result. Required failures reject that stage. A documented optional legacy getter failure is UNKNOWN, not zero. The internal quoting examples below include a source-verified getter set; do not apply them to other implementations with missing fee methods. Recheck B's canonical hash before relying on the final result. The [Multicall reference](../multicall.md) defines deployment verification, chunk limits and same-block retries.

## 1. Resolve TTAI and state search coverage

Send both connected platform searches for the **user-supplied ticker**:

```http
GET https://bsc-api.tagai.fun/community/search?tick=TTAI
X-Chain-Id: 56
```

```http
GET https://bnb.taxed.fun/extension/search?q=TTAI
```

TagAI returns an array, not a c/d envelope. Keep BSC rows with valid addresses. First find case-insensitive **exact** ticker matches, then deduplicate by chain/address. BabyTTAI, TTAIDAO and XTTAI are substring hits, not exact TTAI alternatives. At the recorded observation, the exact candidates were:

| Symbol | Full address | Verified issuer / market after recipe 2 |
| --- | --- | --- |
| TTAI | 0x8e11E90B463bf521382E2B88539F053270a3848c | TagAI / external Pancake V2 |
| ttai | 0x51B561b3e30E626142A710E5e36da46A7DD124A5 | TagAI / internal curve |

The Flap ordinary HTTP endpoint returned 403 from the test environment. Its separate ID Agent registry search found no matching market; follow [Flap](../platforms/flap.md) for that on-chain search. At this historical observation, Fourme and GANG search coverage was not integrated. GANG now has an [independent search and proof workflow](../gang/worked-examples.md); refresh it for current requests. Therefore report **two verified TagAI candidates with incomplete other-platform search coverage**, never "TTAI exists only on TagAI" or "no Flap token exists." An HTTP error is not a negative search result.

For a price query, inspect and show both exact candidates without needing wallet login. For a trade / amount quote, ask which address the user means if both remain. Do not buy until that ambiguity is resolved. For the rest of the TTAI example, **assume the human explicitly selects 0x8e11E90B463bf521382E2B88539F053270a3848c**; the example does not make that selection for a live user.

## 2. Prove issuance, read state, and calculate the price

Read eth_chainId and require 0x38. Read a fresh eth_getBlockByNumber("latest",false); save B/hash/timestamp and verify MC runtime using the shared chain procedure.

### Stage 2A: integrated issuer proofs

For each candidate, build the following one-snapshot Multicall set. Read actual current addresses from the registry; do not ask the user to identify the platform.

| To | Method / exact args | Decode |
| --- | --- | --- |
| Each registry Pump with issuanceGetterDocumented=true and marketFamily!=import | createdTokens(candidateAddress) | bool; one true identifies the exact trusted Pump |
| Flap ordinary Portal 0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0 | getTokenV8Safe(candidateAddress) | Full tuple, or decode matching TokenNotFound(candidateAddress) as NO_MATCH |
| Flap ID Factory 0xC55820f24015bE7c4f18949D9e1363A3609B300e | isMarket(candidateAddress) | bool |
| Same Flap ID Factory | marketOfToken(candidateAddress) | Registered market address or zero |

createdTokens(address) selector=0xb3126103; use [read-interface ABI](../../abis/tagai/read-interfaces.json). The observed positive proof for selected TTAI was TTAI Pump.createdTokens(TTAI)=true; that Pump returned false for the other ttai address. The other ttai's positive proof was its different Pump. The deployed first Pump exposes this getter even though its older exported ABI omitted it; do not skip that Pump or infer issuance solely from API version hints. The verified getter is now in the runtime proof set.

For selected TTAI, Flap's matching TokenNotFound and ID Factory false/zero were normal on-chain negatives. They concern that exact address, not every similarly named token. These historical observations did not include GANG proofs. Current requests also read every [GANG launchpad](../../config/gang-bsc.json); Fourme remains unverified. Multiple positive issuing platforms stop a trade until resolved; API import registration is not native TagAI issuance.

### Stage 2B: selected token state

| To | ABI / method(args) | Recorded selected TTAI result |
| --- | --- | --- |
| TTAI | ERC20.name(), symbol(), decimals() | TTAI, TTAI, 18 |
| TTAI | Token.listed() | true → external; do not quote its old curve |
| TTAI | Token.bondingCurveSupply() | 650000000000000000000000000 |
| TTAI | bondingCurve() using the linked verified binding-getter ABI; no args | TTAI Pump; this optional shared read succeeds for this observed deployment |

Do not require listingPending / dynamic modern fee getters on an old token whose ABI does not define them. For modern tokens, those state fields are required and a pending flag stops both inner directions. Apply [identity rules](versions.md), not a guessed default for a missing result.

### Stage 2C: verify TTAI's V2 pool

All at B, use the DEX ABI:

| To | Method / args | Require |
| --- | --- | --- |
| Pancake V2 Router | factory() | Trusted Factory above |
| Pancake V2 Router | WETH() | WBNB above |
| Pancake V2 Factory | getPair(TTAI,WBNB) | Nonzero actual pair; observed pair above |

Dependent Multicall at the same B:

| To | Method / args | Use |
| --- | --- | --- |
| Returned pair | factory(), token0(), token1(), getReserves() | Trusted Factory, exact TTAI/WBNB asset pair, positive reserves |

Map reserve0/reserve1 using token0/token1; do not assume lexical order. The recorded mapped reserves were tokenReserve=469496850710988923879440835 and nativeReserve=31470788790588337203. Reference BNB wei per 1 TTAI is floor(nativeReserve*10^18/tokenReserve), giving **0.000000067030883685 BNB/TTAI** at B. This excludes order-size effects and trade fees.

For the other exact candidate, listed=false. Read supply S=301538280954880474592, bind its curve to its issuing Pump, then in a dependent Multicall call **that Pump.getPrice(S,1000000000000000000)** using the shared read ABI. It returned the one-token curve increment price **0.000000006500007799 BNB/ttai**. Do not use this price or address for the selected external TTAI.

User-facing response example, translated to the user's language: list both symbols, full addresses, verified issuer, internal/external market, correctly labeled BNB price and observation time. Keep selectors, release numbers and implementation groupings in agent state. For a buy, request address selection if still ambiguous.

## 3. Quote a selected external TTAI buy with 0.001 BNB

Run recipes 1–2 again as needed for fresh identity/state; retain the user's selected address. Do not connect a wallet merely for this amount quote. At B call:

```solidity
// to Pancake V2 Router; view; through Multicall; value=0
getAmountsOut(
    1000000000000000,
    [0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c,
     0x8e11E90B463bf521382E2B88539F053270a3848c]
)
```

Full signature=getAmountsOut(uint256,address[]), selector=0xd06ca61f. Decode uint256[]; require length=2, amounts[0]=G, amounts[1]>0. The Router / Factory binding proves this path selects the quoted pair. TagAI-native external trades execute directly through that DEX.

At the recorded block:

```text
inputWei       = 1000000000000000
quoteOutRaw    = 14880728543974126146100
slippageBps    = 100
minimumOutRaw  = floor(quoteOutRaw * 9900 / 10000)
               = 14731921258534384884639
expected       = 14880.7285439741261461 TTAI
minimum        = 14731.921258534384884639 TTAI
```

Theoretical Router output is not proof of recipient delivery, especially for taxed tokens. The final SupportingFeeOnTransfer call must simulate successfully from W with its protected minimum. Never replace a failed quote with reserve-price multiplication. Quote-only requests end here with the amount, price/time, slippage and gas excluded; do not obtain a wallet preview or broadcast.

## 4. Buy the selected TTAI and submit its confirmed wallet preview

For a trade request, use the existing connector or installed CLI to check:

```bash
baw wallet status --json
baw wallet address --json
baw wallet settings --json
baw wallet tx-lock --binanceChainId 56 --json
```

Require connected status, owned chain-56 W, devMode.enabled=true, and no unresolved pending transaction. If a capability is missing, follow the wallet's actual schema / authentication reference; do not require cloning the trading repository. Query eth_getBalance(W,B) and estimate the exact call's gas; reserve separate BNB for gas. A 0.001 BNB buy budget does not include network fees. Native BNB needs no ERC20 approval.

Encode with the exact DEX ABI:

```solidity
swapExactETHForTokensSupportingFeeOnTransferTokens(
    minimumOutRaw,          // fresh recipe-3 final token floor, raw TTAI units
    [WBNB,TTAI],            // same path used by getAmountsOut
    W,                      // owned wallet; default recipient
    D                       // now + 180, Unix seconds, not milliseconds
)
```

Full signature=swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256); selector=**0xb6f9de95**. Envelope: chainId=56, from=W, to=**Pancake V2 Router**, valueWei=**1000000000000000**. The to address is neither TTAI nor Pump nor wrapper. A recipient override must be explicit and verified.

Independently decode calldata and compare minimum/path/recipient/deadline to the plan. Simulate this **complete** call with a single eth_call({from:W,to:Router,value:"0x38d7ea4c68000",data:encodedCall},B). A successful Router02 SupportingFeeOnTransfer simulation returns **0x** because this function has no return; do not misinterpret it as zero tokens or try to decode uint256. Simulation failure stops the trade. Recheck B's hash and quote age; refresh if expired.

Request the actual wallet preview using that exact transaction:

```bash
baw contract-call preview --binanceChainId 56 --from <W> \
  --to 0x10ED43C718714eb63d5aA57B78B54704E256024E \
  --value 1000000000000000 --inputData <fresh-encoded-call> --json
```

Require success, a usable requestId, unexpired expiresAt, successful simulation and consistent parsedTx / asset changes. Render parsed wallet risks and authorityChanges; never bypass a blocked preview. Example user-facing preview fields:

```text
Buy TTAI on BNB Smart Chain
Token: 0x8e11E90B463bf521382E2B88539F053270a3848c
Issuer / market: TagAI / external market
Spend: 0.001 BNB, plus separately estimated network fee
Expected: <fresh quote> TTAI
Minimum: <fresh protected minimum> TTAI
Slippage: 1% (or the user's chosen value)
Wallet / recipient: <actual full W>
Wallet risks / approvals: <actual preview result>
Submit this transaction?
```

Do not show the historical figures as a fresh preview. Save the exact transaction, selected token, W, quote expiry, requestId and preview contents. Only after the human confirms that preview:

```bash
baw contract-call execute --requestId <that-successful-confirmed-requestId> --json
```

Do not ask for the same confirmation again or reconstruct a new call. Mark SUBMITTING before sending. Save orderId/txHash. BROADCASTED is pending chain confirmation; PENDING_CONFIRMATION needs Binance App approval, never another execution. Check canonical successful receipt and actual TTAI delivery from token transfer logs / wallet asset changes before reporting realized output. Unknown submission means check history by exact identity, not retry. Follow [wallet recovery](../binance-wallet.md) if uncertain.

## 5. Sell 1000 of the selected external TTAI

Resolve / verify the same selected token and current pool. At B use one Multicall for ERC20.balanceOf(W), allowance(W,Router) and required token / pool state. Require balance>=**1000000000000000000000** (1000*10^18). Quote at Router with **getAmountsOut(1000000000000000000000,[TTAI,WBNB])**. The recorded output was 66863164417538 wei = 0.000066863164417538 BNB; its 1% floor was **66194532773362 wei**. Re-read these for the live request.

If allowance is insufficient, separately preview token.approve(Router,1000000000000000000000), from=W, to=TTAI, value=0, using the ERC20 ABI. This is a finite token approval, not a sale. Confirm it, wait for receipt, then refresh balance/state/quote and show a **new trade preview**. Reset a nonzero allowance first when required by the actual token. No unlimited approval; the spender is Router, never Pump / wrapper.

Then encode:

```solidity
swapExactTokensForETHSupportingFeeOnTransferTokens(
    1000000000000000000000, // amountIn: raw token units
    freshMinimumBnbWei,    // final BNB floor, not token units
    [TTAI,WBNB], W, D
)
```

Selector=0x791ac947, to=Router, from=W, value=0. Full signature has uint256,uint256,address[],address,uint256. Simulate the complete actual-wallet call, then use recipe 4's wallet preview / confirmation / execute flow. This SupportingFeeOnTransfer method also returns no value. A successful approval is not a sale; a quoted BNB figure is not realized proceeds. Verify actual net BNB delivery / trace or wallet asset changes, excluding gas and unrelated transfers.

## 6. Internal contrast: buy AIPRO with 0.001 BNB

First resolve the current AIPRO address and prove native issuance; the observed address and Pump are in the shared table. This recipe applies only while listed=false and listingPending=false on the matching source-verified implementation. If listed=true, load [external methods](external.md), verify the actual pool and select that quote / execution method. Do not call buyToken merely because this example once used it.

### Stage 6A: required state and buyer gate

One Multicall at B:

| To | Method / args | Observed / required |
| --- | --- | --- |
| AIPRO | ERC20.name(), symbol(), decimals() | AIPRO, AIPRO, 18 |
| AIPRO | listed(), listingPending() | false, false |
| AIPRO | bondingCurve(), bondingCurveSupply() | Exact AIPRO Pump; S below |
| AIPRO | getBuyFeeRatios() | platformBps=30, subjectBps=30 at the observation |
| AIPRO Pump | tokenImplementation() | 0x8851D281f76951d41C9ff5c820D2D387f820f073 |
| Handle registry | handleOf(W) | A nonempty string is required for this buy |

Verify the token's canonical clone implementation against the recorded implementation with the normal code identity check at B. Wallet connection alone does not establish the handle. If empty / unreadable, stop the buy and explain its specific buying requirement. Do not redirect it to another venue; sales do not need this handle gate.

Recorded S=**284811666433559752360740107**. To obtain the one-token reference price, a dependent Multicall calls **AIPRO Pump.getPrice(S,1000000000000000000)**. It returned **20148026548 wei**, or 0.000000020148026548 BNB/AIPRO. This is a one-token curve increment price before fees; do not multiply it by a large amount as an executable quote. Curve progress was floor(S*10000/650000000000000000000000000)/100 = 43.81%.

### Stage 6B: exact amount quote

Target: **AIPRO Pump 0x97f35B4631F4FFBF8050B17fAd6579D6F60A289D**. ABI: [shared TagAI reads](../../abis/tagai/read-interfaces.json). Call through Multicall at B:

```solidity
getBuyAmountByValue(
    284811666433559752360740107, // supply: AIPRO.bondingCurveSupply() at B
    1000000000000000            // funds: 0.001 BNB in wei
)
```

Signature: getBuyAmountByValue(uint256 supply,uint256 funds) returns(uint256 amount). Selector: **0xb3368bb2**. Return: **49627760779259275379321** raw AIPRO = **49627.760779259275379321 AIPRO**. With slippageBps=100, minimum=floor(amount*9900/10000)=**49131483171466682625527** raw AIPRO = **49131.483171466682625527 AIPRO**.

If curveOut reaches the remaining curve cap, apply the source-verified cap/refund branch in [internal methods](internal.md); do not use the unconstrained output. The observed example did not hit that branch. No wallet signing is needed for a read-only quote, but this buyer-specific eligibility check needs the actual W.

### Stage 6C: transaction

```solidity
// to AIPRO itself; payable; from W; valueWei=1000000000000000
buyToken(
    49627760779259275379321, // fresh expected output, NOT the already reduced minimum
    0x0000000000000000000000000000000000000000, // default fee subject
    100                     // slippage bps applied by the Token once
)
```

Full signature=buyToken(uint256,address,uint16), selector=0x9c4c5062. Replace the first argument with the **fresh quote** for real use. Do not send this transaction to Pump, Router or wrapper. No BNB approval. The caller receives the tokens; this ABI has no custom recipient argument. With user slippage=0, use the protected transformation in [internal slippage](internal.md), never pass zero and disable protection.

Decode and simulate exact from/to/value/calldata. Unlike Router02's method, this ABI returns uint256; decode with the matched token ABI. Use recipe 4's real wallet preview / confirmation / execute flow with **to=AIPRO** and the internal calldata. Internal buy success can queue migration if it fills the cap; verify the receipt and new state before describing an external market.

The recorded full-call simulation returned 49330023385523107940646 raw AIPRO (49330.023385523107940646), above the protected minimum. That is a simulated delivery estimate, distinct from the full-funds curve quote. Use the actual wallet simulation's asset changes / delivery estimate in the final user preview and keep the quote's protected minimum. Never claim the curve quote is guaranteed delivery, lower its minimum to force a simulation to pass, or report a read-only simulation as a completed purchase.

## 7. Internal contrast: sell 1000 AIPRO

At B read balanceOf(W), supply S, listed/pending, bound curve and **AIPRO Pump.getFeeRatio()** in Multicall. Require token amount A=1000000000000000000000 <= balance and <=S. A sell does not require handleOf(W). This internal Token method uses its own balance logic; **no ERC20 approval** to Pump / Router / wrapper is needed.

Dependent Multicall: **AIPRO Pump.getPrice(S-A,A)**. With the observed S, args are **[284810666433559752360740107,1000000000000000000000]**. It returned gross=**20147986492614** wei. Deduct each live fee separately: floor(gross*30/10000)=60443959477 twice. Net=**20027098573660** wei, minimum at 1%=**19826827587923** wei.

```solidity
// to AIPRO; nonpayable; from W; value=0
sellToken(
    1000000000000000000000, // exact token amount
    20027098573660,         // fresh NET expected BNB, not gross and not reduced minimum
    0x0000000000000000000000000000000000000000,
    100
)
```

Full signature=sellToken(uint256,uint256,address,uint16), selector=0xbd2bb69b. Refresh all numerical arguments for live use; the Token applies the slippage bound. Simulate from W, then preview and execute only the confirmed requestId. The sale ABI has no return value; verify net BNB using the matching Token Trade event after its separately recorded fees / wallet asset changes, not a fabricated uint256 return. Amount quotes are estimates until receipt evidence exists.

## Outcome boundaries

- Lookup: show verified candidates and coverage; never sign.
- Quote: show real input/output/minimum, time and units; never sign or broadcast.
- Prepare: verify actual owned wallet, exact calldata and successful wallet preview; request human confirmation.
- Confirmed execution: submit the same unexpired requestId once; do not rebuild or request duplicate confirmation.
- Failure: report the actual blocker. Do not choose the easier same-name token, change native TagAI to a wrapper, widen slippage, guess a new ABI, or infer success from a quote / approval.

The structured observations and ABI regression tests demonstrate these recipes; they do not preauthorize the historical example transactions. Keep implementation details in agent state and present the user's token facts and financial preview in their preferred language.
