# Flap ID AGENT CURVE

For concrete calls, start with the [0.001 BNB buy and 50% share-sale examples](worked-examples.md). They include market / predicted-token addresses, explicit-wallet quotes, final transaction parameters and wallet submission steps.

Read only for a market / predicted token from this app. Fetch the [registry](../../config/flap-bsc.json) and [typed JSON ABI](../../abis/flap/agent-curve.json) using existing tools. These methods come from the app published at [Flap Apps](https://flap.sh/apps/agent-bonding-curve), distinct from the ordinary Portal launch skill.

## Contracts and identity

| Role | BSC address |
| --- | --- |
| Factory | 0xC55820f24015bE7c4f18949D9e1363A3609B300e |
| Trading Portal | 0x49387D2E6cbF8FefE856e3FBc3E98a01aC3af062 |
| Reader | 0x18Aa6C93f1887a243fdc348C9A77F5136555174a |
| Market Beacon | 0xe6af4e69982821A48D2e759991B96f14Fbbc9a1F |
| Probe Beacon | 0x8E6F34B590E825AeEb352aBc69e16051C4D28c00 |
| Agent ID | 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F |

Verify Factory/Portal/Reader proxy implementations and runtime hashes from the registry, including the Market Beacon implementation. In fixed-block Multicall require Portal.factory=Reader.factory=trusted Factory, Factory.marketBeacon=trusted Beacon, Factory.isMarket(market)=true, market.portal=trusted trading Portal. Resolve token input with Factory.marketOfToken(token), then check predictedToken/token against that exact input.

Phase 1=open virtual market, 2=launching, 3=launched. Before phase 3 the predicted token can have no code. The bought asset is an 18-decimal **non-transferable ledger share**. Show this fact and the full market / predicted-token addresses in a preview. Phase 3 does not mean the wallet claimed its tokens, nor identify the later DEX protocol. Do not turn a closed share sale into a token sale.

## Typed reads

The JSON ABI contains complete nested tuples for Reader.marketDetail(market), marketSettings(market), and userPosition(market,wallet), all view. Call them at **Reader**, not Market. Pin every stage to one block and use Multicall.

- marketDetail: phase, quoteToken/quoteDecimals, poolRaw/capRaw/remainingRaw/progressBps, predictedToken/token/pair, totalShares, agentFeeBps, backing and inventory flags.
- marketSettings: launch name/symbol, quote identity, curveR/H/K, cap and configuration hash. Require agreement with detail.
- userPosition: explicit wallet, owned shares, remainingWalletShares, eligibilityKnown/eligible, claimableRaw and inventory coverage. ERC20 balance is not this share position; unknown flags are not zeros.

Progress percent=progressBps/100. An open-market reference price in 18-decimal quote units is curveK*1e18/floor((1e9*1e18+curveH-totalShares)^2/1e18), with positive denominator. Name the currency. This reference does not replace a trade quote. Price queries need no wallet.

Buying requires nonempty handleOf(wallet), known eligible state and remaining capacity. Selling and claiming do not require Agent ID. A Binance connection alone does not prove eligibility. Explain this requirement to a user only when relevant to their requested buy.

## Probe caller limitation

The app's nonpayable *Probe methods return readings through intentional Error(string) reverts. They read **msg.sender** positions. A fixed-block live comparison on 2026-10-27 found a positive Reader.userPosition(market,holder).shares while a sharesProbe subcall through Multicall reported SHARES=0 for the same outer from. Therefore do not trust wallet-sensitive batched Probes or fall back silently to individual probe RPCs.

Use explicit-wallet typed Reader / Portal views for state and buys. For a percentage sale use a **complete actual-wallet Portal sale simulation**, preserving msg.sender. This is execution simulation, not a batch state-read fallback. If a client lacks typed decoding or actual-caller simulation, name that missing capability; cloning does not fix caller semantics. Do not broadcast Probes or use fixed-5%-slippage probe helpers under a different chosen slippage.

## Native BNB buy

```solidity
function quoteBuy(address market,address wallet,uint256 grossWei) external view
    returns (uint256 acceptedGross,uint256 fee,uint256 refund,uint256 shares);
function buy(address market,uint256 minShares) external payable returns (uint256);
```

Selectors: quote=0x34259b1b, buy=0xcce7ec13. Both target **ID Agent trading Portal**, not ordinary Portal or wrapper.

Require phase=1, quoteToken=zero and eligible real wallet. Parse the BNB budget into grossWei. Quote with the explicit wallet in Multicall; require positive shares, acceptedGross+refund=grossWei and shares within remainingWalletShares. Compute positive minShares=floor(shares*(10000-slippageBps)/10000). Quote fees are already included; show refunds separately.

Build buy(market,minShares), from=wallet, value=grossWei. No native approval. Gross budget plus gas must be available even when a refund is expected. Simulate the complete transaction, obtain the Binance preview, show risks and get confirmation before executing its requestId. Never send BNB to the predicted token.

## Native BNB share sale

```solidity
function sellBps(address market,uint256 bps,uint256 minOut) external returns (uint256);
function quoteSellAll(address market,address wallet) external view
    returns (uint256 shares,uint256 remainingPoolWei,uint256 fee,uint256 bnbOut);
```

Selectors: sale=0x2f9d7c27, full quote=0xae41aa61. to=ID Agent Portal, from=owning wallet, value=0. bps is 1..10000 of the wallet's then-current **share holdings**, not price slippage or BNB. minOut is net settlement base units; native markets return BNB wei. No share-token approval is needed.

Require phase=1 and positive explicit-wallet shares. Use the user-selected percentage, never assume full sale. For 100% an explicit-wallet quoteSellAll can run in Multicall. For other percentages, simulate complete Portal.sellBps(market,bps,1) at the pinned snapshot from the real wallet and decode its uint256 net payout. That provisional quote payload must **never be broadcast or used as the approval preview**. Replace the floor with positive floor(simulatedNet*(10000-slippageBps)/10000); independently simulate and preview that final protected transaction.

On simulation failure stop; do not change venues or widen slippage. Confirm the exact preview, submit once and verify receipt / ledger / native asset changes. A changed position can alter how many shares bps selects; refresh materially changed previews. Missing actual delivery evidence stays unknown, never replaced by the estimate.

## ERC20-quoted markets

```solidity
function buyWithQuote(address market,uint256 grossQuote,uint256 minShares) external returns (uint256);
```

Selector=0xa7c893c4, value=0. Gross quote uses the settlement token's decimals; spender for finite approval is **Market**, not Portal. Full gross balance/allowance is needed before refunds. Refresh after approval. sellBps returns Q, not BNB.

The outer asset stays BNB. A verified BNB↔Q adapter must precede automation: buy BNB→Q, wait for actual Q delivery, approve Market for that new amount, then buyWithQuote. Sale: sell shares→Q, verify actual delivery, then Q→BNB. Bind later amounts to actual outputs, retain intermediate holdings on failure, never repeat a completed leg or spend old Q implicitly. The runner stops before currently unimplemented conversion legs; it never sends BNB to buyWithQuote or labels Q proceeds BNB.

## Claim and later token trading

```solidity
function claim(address market) external returns (uint256);
```

Selector=0x1e83409a, to=ID Agent Portal, from=owning wallet, value=0. Claim is a **separately requested action**. Require phase=3, actual token binding, positive claim entitlement and sufficient verified inventory. Simulate, preview, confirm, send once, verify actual token delivery and reread position. Zero shares after success is not permission to retry. Do not chain claim/sale under a price query or unrelated buy confirmation.

For later ERC20 sales read the wallet's actual claimed balance and ordinary Flap state, then verify its current DEX pool using [external routing](external.md). Market.pair / predictedToken / phase provide no external quote. The runner has no claim command; a tool-native agent can construct an explicitly requested claim with this ABI and the same safeguards.

The [recorded examples](../../config/flap-worked-examples.json) contain ABI-decoded buy/sell calls and their successful read-only simulations.
