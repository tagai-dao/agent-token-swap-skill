# 外盘 DEX 数据与路线

目前 DEX 注册表为空，不能真实查池、报价或交易。仅允许后续显式接入的 Uniswap / PancakeSwap 协议变体和 BSC 部署；不支持其他品牌，也不能把“V2 兼容”当成第三方 DEX 已获支持。

## 池发现与核验

这里只发现用户指定代币的交易路线，不发现或推荐代币。

API / 索引器可以提供候选池。Router、Factory、Quoter、Manager、wrappedNative、Hook 能力来自经过核验的配置，不能由任意 API 响应决定授权目标。

- V2：读 token0/token1、factory、reserves；核验官方 Factory.getPair 与候选 pair 相同，并核验 Router.factory / wrapped native。
- V3：核验 token0/token1、fee、factory、Factory.getPool、流动性和当前价格；Router 和 Quoter 必须属于同一兼容部署。不同 exactInputSingle tuple 的 Router 不可混用 ABI。
- V4 / Infinity：核验完整 PoolKey、poolId、Manager / Vault、hooks、fee、parameters 或 tickSpacing；Uniswap V4 与 Pancake Infinity CL 不是同一种结构。Infinity Bin 不因为同属 Pancake 而自动支持。
- 明确候选池覆盖范围。不能仅按流动性最大选池，也不能在候选不全时声称全网最优。

相关链上合约读取全部使用固定区块 Multicall。按金额比较净到账，包含池费、wrapper 费用、Hook 费用、税、中转和 gas；买入比较总 BNB 成本与净代币量，卖出比较扣除 gas 后的 BNB 净收益。

## 执行入口

TagAI 原生币：读取 [TagAI](platforms/tagai.md)，按真实版本和上市快照选择 DEX 方法，不走 ImportedTokenSwapWrapper。

其他外盘币：读取 [Wrapper](imported-token-swap-wrapper.md)，优先该入口。使用已核验数据构造 sourceType/sourceData，并确认 quoteToken 的 bridge 路径。

wrapper 不兼容的理由应具体且可验证，例如不支持的 sourceType、Router ABI、税币方向或非空 hookData 要求。此时直接 DEX 仅限本 skill 已接入的部署和方法，仍重新报价、检查真实 spender、模拟、preview。

RPC 超时、缺授权、报价过期、滑点失败、钱包风险拦截不是已证明的兼容性问题。不得借 fallback 规避安全阻断、悄悄提高滑点、扩大预算或违反用户指定路线。

## 价格与模拟

参考价不能代替金额相关的可执行报价。集中流动性需要完整的跨 tick 报价或兼容 Quoter，带 Hook 池必须包含 Hook 行为。精确的 tick / bitmap 数据需求由具体适配器实现，缺数据则排除该路线。

交易模拟使用真实钱包 from、value、授权和 calldata。最终 minimumOut 约束用户净到账，不只约束池返回值。模拟失败不发送，不改成 minimumOut=0。
