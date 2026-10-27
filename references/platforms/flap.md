# Flap Quotes and Trading

Start with [call examples](../flap/worked-examples.md): ticker lookup, token information, ordinary internal buy/sell, ID Agent buy/50% sale, and external wrapper buy/sell. Each recipe gives targets, ABI methods, parameter values, return values and wallet steps. Use the recipe matching the observed market; consult the details below when needed.

Use existing HTTP / ABI / RPC and Binance wallet tools. No checkout, npm installation or Flap launch-skill installation is required. Fetch the [deployment registry](../../config/flap-bsc.json) and needed JSON ABIs individually. The optional runner implements the same verified subset.

## Select the actual market

| Market | Issuance / identity proof | Execution |
| --- | --- | --- |
| Ordinary Flap token | Official Portal returns registered token state | Ordinary Portal methods below |
| ID AGENT CURVE | Factory.isMarket(input), or Factory.marketOfToken(input) plus verified market/predicted-token binding | Read [ID Agent Curve](../flap/agent-curve.md); internal assets are ledger shares |
| Graduated token | Portal status=DEX and verified actual listing pool | Read [external trading](../flap/external.md); prefer ImportedTokenSwapWrapper |

Include both Flap proof interfaces and integrated TagAI proof interfaces in fixed-block Multicall. A match in both Flap registries is still one issuing platform. A market-address input keeps referring to its ledger / claim state after launch; never silently change a closed share sale into an ERC20 sale.

For a supplied address, ordinary Portal status=1 establishes an internal Flap market even when ID Agent Factory.isMarket=false, marketOfToken=zero and TagAI createdTokens=false. Read [the AIPRO address example](../flap/worked-examples.md#query-a-contract-address-aipro). Internal markets are priced through their platform contracts; pool discovery belongs to external-market routing.

There is **no verified blanket Binance-only restriction for all Flap tokens**. The [official skills page](https://docs.flap.sh/flap/skills) focuses on launching tokens; the [Binance tutorial](https://docs.flap.sh/flap/skills/using-with-binance-agentic-wallet) explains signing. The separately published ID AGENT CURVE app requires Agent ID for buying, while selling / claiming do not. A Binance connection alone does not prove admission. Enforce actual restrictions and full real-wallet simulation.

## Ticker or address

For a Flap /bnb/ token link, use its path address as the selected input. The [AIPRO link example](../flap/worked-examples.md#query-a-flap-token-link-aipro) shows the actual token, Portal calls and SPCXB-denominated price. A supplied address or link proceeds directly to chain reads; HTTP search is the ticker path.

The ordinary BSC frontend search is `GET https://bnb.taxed.fun/extension/search?q=<URL-encoded query>`. The frontend accepts an array of `{coin:{address,name,symbol,...},listed,...}` or flat `{address,name,symbol,img,...}`. Preserve response order; ranking / pagination are not documented by this call. It returned HTTP 403 from the development environment on 2026-10-27: report unavailability, not token absence, and do not bypass access challenges.

For a user-specified ID Agent ticker, Reader.marketPage(cursor,limit), limit<=16, and marketCards(address[]) provide a chain-native alternative. Pin every page and follow-up to one block. Search only the requested name; return matching candidates, not an unsolicited feed. The runner scans at most 1000 registered markets and reports incomplete coverage beyond that. Reverse registry order for newest matching creations first. Ordinary HTTP search failure remains a coverage gap for ordinary tokens.

Deduplicate by chain/address. Continue automatically on one exact ticker match, showing its full address. For duplicates show up to three candidates for selection. Before deployment explicitly label both the market address and predicted token address. Names, suffixes and API labels are not issuance proof.

## Ordinary Portal identity and state

Portal=`0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`. Use [portal.json](../../abis/flap/portal.json). Verify chain, pinned proxy runtime, EIP-1967 implementation and its runtime against the registry. An upgrade requires updated verification. All related contract reads use Multicall; deployment identity checks retain the same snapshot.

| Method | Selector | Interpretation |
| --- | --- | --- |
| getTokenV8Safe(address) view | 0x62fafcca | Registered state with separate buy/sell taxes and uint8 enum fields |
| getTokenV9Safe(address) view | 0x0b66cff1 | Same fields plus token-specific uint16 bondingCurveFeeRate; official frontend ABI, verified live |
| getFeeRate() view | Calculate from ABI | Global buy/sell fees in bps; not necessarily the token fee profile |
| enableTaxOnBondingCurve() view | Calculate from ABI | Whether extra curve tax is enabled |

V8Safe tuple order:

```text
uint8 status, uint256 reserve, uint256 circulatingSupply, uint256 price,
uint8 tokenVersion, uint256 r, uint256 h, uint256 k,
uint256 dexSupplyThresh, address quoteTokenAddress,
bool nativeToQuoteSwapEnabled, bytes32 extensionID,
uint256 buyTaxRate, uint256 sellTaxRate, address pool,
uint256 progress, uint8 lpFeeProfile, uint8 dexId
```

V9Safe appends bondingCurveFeeRate. Its failure is optional only if required V8Safe succeeds. Decode with the full JSON ABI. Status: 0 Invalid, 1 Tradable, 2 obsolete InDuel, 3 obsolete Killed, 4 DEX, 5 Staged. A decoded zero or matching TokenNotFound(token) is NO_MATCH; unknown reverts / failed RPC / decode failure are UNKNOWN. Staged is not an issued tradable token. Trade only verified status 1 below the threshold, or verified status 4 external routes. Progress=100% alone does not prove DEX readiness.

Price is 18-decimal quote-asset value per token; name that currency. Reserve uses quote-asset base units. Progress percent=progress/1e18*100. Read actual decimals. External prices come from the verified pool, not a zero curve price. Flap implementation IDs are unrelated to TagAI IDs: TagAI's V5/V8 exclusions do not disable Flap tax implementation 5 or Flap V8Safe reads. Keep these details internal.

## Ordinary inner quote and quota

```solidity
function quoteExactInput((address inputToken,address outputToken,uint256 inputAmount) params)
    external returns (uint256 outputAmount);
function maxBuyPerOrigin(address token) external view returns (uint16 bps,uint256 maxBuyAmount);
function buyQuotaOf(address token,address origin) external view returns (uint256 bought,uint256 remaining);
```

Quote selector=0xfc847c2b, to=Portal, value=0, nonpayable **eth_call only**. Buy tuple=(zero,token,bnbWei); sell tuple=(token,zero,tokenAmountRaw). See the [0.001 BNB buy and 1000-token sale](../flap/worked-examples.md) for concrete calls and outputs.

Quota selectors: maxBuyPerOrigin=0x4b02c8e9, buyQuotaOf=0x929b098c. Zero cap is uncapped; maxUint256 remaining means no quota. Capped amount quotes need the actual executing origin. Set the **outer Multicall eth_call from** to that wallet for quota / quote stages; ordinary Portal quotes use tx.origin, preserved by Multicall. For relayed / smart-wallet execution verify the actual origin. Incompatible caller semantics must be resolved explicitly, never replaced with individual state RPCs.

Quota is cumulative; sales do not restore it. Excess input may be refunded or produce zero fill. Require positive output and minimum; disclose reduced fill/refund when known. A price query needs no wallet. Do not promise exact input consumption near quota / graduation.

For ERC20 settlement, native buys require nativeToQuoteSwapEnabled=true. Read getQuoteTokenConfiguration(quoteToken) and verify its allowed BSC DEX conversion. Native sales are documented too, but require a successful exact token→BNB quote and transaction simulation. Otherwise use a separately integrated BNB↔Q route with [sequential recovery](../execution.md). Never spend existing Q implicitly or label Q proceeds BNB.

## Ordinary inner transaction

```solidity
function swapExactInput((address inputToken,address outputToken,uint256 inputAmount,
    uint256 minOutputAmount,bytes permitData) params) external payable returns (uint256 outputAmount);
```

Selector=0xef7ec2e7, to=ordinary Portal, from=connected Binance wallet. inputAmount uses input base units; minOutputAmount=floor(netQuote*(10000-slippageBps)/10000)>0. Default slippage=100bps, disclosed. Native buy value=inputAmount wei; sale value=0. Delivery belongs to caller; no recipient argument exists.

Use permitData=0x and a separately confirmed finite ERC20 approval to **Portal** for a sale. Reset a nonzero insufficient allowance first when needed, then approve the finite amount. Refresh the trade after approval receipts. EIP-2612 is optional; verify domain, nonce, chain, spender, amount and Unix-second deadline through wallet typed signing. Never invent signatures or export keys. Nonzero extensionID needs separately verified extensionData / swapExactInputV3; this adapter stops instead of guessing.

Decode final calldata, simulate the full real-wallet transaction, obtain a successful Binance preview, display amounts/fees/risks, then execute that exact requestId after confirmation. Recover uncertain submissions by status, never resend automatically. TokenBought / TokenSold identify token, wallet and settlement amounts, but their eth field can mean ERC20 Q. Verify actual delivery/refunds before reporting final BNB; see [wallet](../binance-wallet.md).

The [recorded examples](../../config/flap-worked-examples.json) contain the exact quote arguments, transaction calldata and read-only simulation results for the linked recipes.

## Coverage and sources

Connected: ordinary Portal internal BNB routes, ID Agent native-BNB buys / percentage sales, and verified external Pancake V2/WBNB pools for supported non-tax / Tax Token V3 rules. Other quote-asset bridges, pool variants and extensions need separate adapters. A boolean flag is not universal coverage.

Sources: [deployments](https://docs.flap.sh/flap/developers/deployed-contract-addresses), [inspection](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/inspect-a-token), [trading](https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/trade-tokens), [quota](https://docs.flap.sh/flap/developers/preview/recent-release/v5.14.16-buy-quota), [Agent Curve app](https://flap.sh/apps/agent-bonding-curve), [ABI provenance](../../abis/provenance.json), [test evidence](../../config/flap-source-evidence.json).
