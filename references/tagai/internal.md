# TagAI Internal-Market Calls

Read [versions](versions.md) first. V5 and V8 are unsupported; no signatures are requested or constructed for them. V6 / V10 are imported assets. All methods below target the verified token address, not the Pump, DEX Router, or wrapper.

## ABI selection and signatures

| Version | ABI file | Payable buy signature | Return |
| --- | --- | --- | --- |
| 1 | [token-v1](../../abis/tagai/token-v1.json) | `buyToken(uint256 expectAmount,address sellsman,uint16 slippage,address receiver)` | uint256 |
| 2 / 3 / 4 | [v2](../../abis/tagai/token-v2.json), [v3](../../abis/tagai/token-v3.json), [v4](../../abis/tagai/token-v4.json) | `buyToken(uint256 expectAmount,address sellsman,uint16 slippage)` | uint256 |
| 7 | [token-v7](../../abis/tagai/token-v7.json) | `buyToken(uint256 amount,address sellsman,uint16 slippage)` | no return in this version's ABI |
| 9 / 11 | [token-v9](../../abis/tagai/token-v9.json) | `buyToken(uint256 expectAmount,address sellsman,uint16 slippage)` | uint256 |
| 13 / 14 | [token-v13](../../abis/tagai/token-v13.json) | `buyToken(uint256 expectAmount,address sellsman,uint16 slippage)` | uint256 |
| 15 / 15-2 | [token-v15](../../abis/tagai/token-v15.json) | `buyToken(uint256 expectAmount,address sellsman,uint16 slippage)` | uint256 |
| 16 | [token-v16](../../abis/tagai/token-v16.json) | `buyToken(uint256 expectAmount,address sellsman,uint16 slippage)` | uint256 |

Sales use nonpayable `sellToken(uint256 amount,uint256 expectReceive,address sellsman,uint16 slippage)` with no return. V7 names the second argument `minReceive`; preserve its ABI and verify its exact source semantics before relying on legacy slippage behavior. Parameter names alone do not prove semantics.

Calculate selectors from each supplied JSON ABI with ethers Interface, rather than transcribing them. The offline encoder returns the exact selected signature, selector, and decoded arguments. Internal methods have no on-chain deadline except excluded variants; a local quote expiry cannot cancel a transaction already submitted. Use fresh previews and meaningful output protection.

## Arguments and caller semantics

| Argument / transaction field | Meaning |
| --- | --- |
| `from` | The owned Binance Agentic Wallet address; token delivery, seller balance, buyer gate, and BNB refunds depend on this caller |
| `to` | The proven TagAI token contract |
| `msg.value` on buy | Gross BNB budget in wei, including internal-market fees and excluding separate gas |
| `expectAmount` / V7 `amount` | Expected recipient token quantity from the version-correct quote, in token base units; not BNB input |
| sale `amount` | Exact intended token base units; verify balance rather than relying on contracts that clamp an oversized amount |
| `expectReceive` | Expected net BNB proceeds in wei, after the exact per-fee rounding |
| `sellsman` | IPShare subject / fee attribution. Zero invokes the contract's default subject. A nonzero address may require an existing IPShare; it is not the IPShare contract address |
| `slippage` | Basis points with denominator 10000; source-verified modern implementations skip protection when zero |
| V1 `receiver` | Extra address required only by V1. The helper uses zero for the established default-caller flow; custom receiver semantics require verified V1 source |
| sell `msg.value` | Zero |

Internal sells transfer the caller's balance using the Token's own logic and ordinarily require no ERC20 approval. Do not approve a Pump, wrapper, or DEX for this step. Buy output and sale BNB go to the caller in the standard path; reject a custom recipient instead of silently changing delivery. Never buy by an empty-calldata BNB transfer: its receive path lacks the explicit minimum-output parameters.

## Buyer eligibility

For V15, V15-2, and V16, call `handleOf(address wallet) view returns (string)` on the HandleRegistry in the [registry](../../config/tagai-bsc.json) through the same snapshot's Multicall. Only a nonempty string establishes buy eligibility. Empty means blocked; failure means UNKNOWN. Do not infer registration merely because the wallet is connected to Binance.

All post-creation internal buys are checked, including a creator's later purchases and direct BNB transfers. The atomic creation premine exception does not apply to an ordinary wallet buy. Sales do not require a buyer handle. V15-family transfer restrictions also prohibit moving curve tokens to another user, Router, or Vault before listing; an external route cannot bypass the gate.

## Buy quote: source-verified modern family

Stage A reads supply S, the actual curve / Pump, listed / pending state, token decimals, createdAt when needed, wallet eligibility, and current `(platformBps, subjectBps)` from Token.getBuyFeeRatios(). Stage B calls the proven curve through Multicall at the same block:

```solidity
function getBuyAmountByValue(uint256 supply, uint256 funds)
    external pure returns (uint256 amount);
```

| Parameter | Value |
| --- | --- |
| `supply` | Token.bondingCurveSupply() at the pinned block, in raw token units |
| `funds` | parseUnits(userBnbAmount, 18), in wei |
| Return `amount` | Token quote in raw token units |

Example: quote 0.001 BNB of AIPRO on its internal market. Target=0x97f35B4631F4FFBF8050B17fAd6579D6F60A289D; use the shared read ABI:

```solidity
getBuyAmountByValue(
    284811666433559752360740107, // supply from bondingCurveSupply()
    1000000000000000            // 0.001 BNB in wei
)
```

At the [recorded snapshot](worked-examples.md), the return was 49627760779259275379321. Set quotedOut=min(amount,curveCap-S), then minimumOut=floor(quotedOut*(10000-slippageBps)/10000). The payable buy uses msg.value=1000000000000000. Simulate the complete actual-wallet transaction before obtaining its wallet preview.

A fill-to-cap buy uses a separate gross-up calculation, can refund unused BNB, and queues listing in V13+. The pinned source uses `usedBnb=floor(curve.getPrice(S, remaining)*10000/(10000-platformBps-subjectBps))`; exact fee and refund behavior must be checked by full simulation. Filling during the anti-snipe window can revert `ListingDisabledDuringAntiSnipe`. Do not promise immediate external trading after the fill.

For older versions without a source-verified dynamic getter, obtain exact fee behavior from the matched deployment's source. Getter failure is not permission to apply a modern formula. A theoretical quote must never become a production claim without version-correct simulation.

## Sell quote: source-verified modern family

Read wallet balance, S, actual curve and Pump.getFeeRatio() in stage A. Require intended amount A <= wallet balance and A <= S. In stage B at the same block:

```text
grossBnb    = curve.getPrice(S - A, A)
platformFee = floor(grossBnb * platformBps / 10000)
subjectFee  = floor(grossBnb * subjectBps  / 10000)
netBnb      = grossBnb - platformFee - subjectFee
```

The Pump convenience `getSellPriceAfterFee(S,A)` may round the combined fee differently from the Token's two separate fee deductions. Use source-accurate rounding and the actual full sale simulation when exact amounts matter.

## Slippage protection and construction

For the modern source, the checked bound is `floor(expectation * (10000 - contractSlippageBps) / 10000)` only when slippage is positive. Never pass zero and assume exact-price protection.

The encoder accepts a positive `quoteOut` and user slippage in [0,9999]. For positive slippage it sends the unadjusted quote as expectation and the user's bps once. For zero tolerance it preserves minimumOut=quoteOut by using contractSlippageBps=1 and `expectation=ceil(minimumOut*10000/9999)`. This prevents the zero-means-unchecked branch while retaining the requested lower bound. Reject overflow or a minimum rounded to zero. Check historical source semantics before using this transformation on legacy versions.

Use the [offline encoder](tools.md), independently decode, then simulate the complete call with the real wallet and value. Required failures such as HandleNotRegistered, TokenListingPending, TokenListed, DustIssue, OutOfSlippage, IPShareNotCreated, InsufficientFund, or refund errors stop execution. Decode custom errors with the matching version ABI where available.

## Receipt verification

Check the trusted Token emitter's version-specific Trade event, trader, direction, token amount, fee subject, BNB accounting and fees. Modern buy events may record used BNB after refund; modern sale events record gross BNB before fees. Do not label both as the same net amount. Verify actual token delivery or net BNB receipt, excluding gas and unrelated transfers. A successful fill may leave listingPending=true; reflect that state instead of reporting the token as already listed.
