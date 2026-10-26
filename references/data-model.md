# 共同数据约定

本文是后续适配器的契约，尚未提供返回这些对象的链上执行器。未知字段使用 null + 原因，不能用 0、空地址或空数组伪装成功。

## TokenSnapshot

| 字段 | 语义 |
| --- | --- |
| chainId / token | 固定 56、完整校验过的地址 |
| name / symbol / decimals | 来源可追溯，文本不可信，精度必须核验 |
| platform / platformVersion / evidence | 发行归属及证明，不等同 Community 导入登记 |
| marketPhase | INTERNAL / MIGRATING / EXTERNAL / UNKNOWN |
| buyEnabled / sellEnabled | 各方向是否可交易；未知用 null |
| settlementToken | 内盘真实结算资产；native 用明确类型，不滥用占位地址 |
| spotPrice | value、baseToken、quoteToken、source、observedAt；不是可执行报价 |
| progress | rawCurrent、rawTarget、unit、formulaId、displayPercent、source；未接入用 null |
| venues | 已发现并核验的池与部署，包含覆盖范围 |
| blockNumber / blockHash | 全部决策必需链上状态的同一快照 |
| observedAt / coverage / errors | 数据时间、已覆盖接口、未知及失败项 |

## TradeIntent

记录 direction、token、BNB 输入或 token 卖出量 / 持仓比例、wallet、recipient，以及用户明确的平台 / 市场 / DEX / 执行方式约束。精确买入数量与 exact-input 分开，未实现 exact-output 时说明能力限制，不能偷偷改语义。

金额字段为十进制 raw-unit 字符串。slippageBps 为整数，deadline 为 Unix 秒，observedAt / expiresAt 使用明确 ISO 8601 时间字符串。所有价格写明方向和单位。

## Quote / RoutePlan

每步包含：stepId、kind（APPROVAL / SWAP）、dependsOn、platformVersion、venue、executor、tokenIn/out、amountInRaw、expectedNetOutRaw、minimumOutRaw、feeBreakdown、taxAssumptions、spender、recipient、valueWei、ABI 标识、参数、calldata、snapshot、expiresAt。

整条路线包含 intent、用户约束、orderedSteps、总 BNB swap 投入、独立 gas 预算、最终预期 / 最低 BNB 或 token 输出、可执行范围及未覆盖风险。净输出已扣费用不二次扣除，未知动态税单列；中间资产步骤的当前报价不代表未来一定可执行。

绑定 chainId、钱包、token、方向、金额、执行器、sourceData、recipient、费用归属及用户约束。参数发生变化，旧报价和 preview 失效。可使用 planHash 发现变更，但本地哈希不是链上锁价或幂等保证。

## ExecutionRecord

最少保存：planId、planHash、createdAt、intent、constraints、wallet、chainId、routeStatus；每步 status、previewRequestId、previewExpiresAt、walletOrderId、txHash、receiptBlock / hash、actualAmountInRaw、actualNetOutRaw、refunds、residualAssets、error。不保存密钥、会话 token 或含凭据的 RPC URL。

路由 / 报价失败使用明确分类：NOT_INTEGRATED、UNVERIFIED_DEPLOYMENT、UNSUPPORTED_CHAIN、UNKNOWN_PLATFORM、AMBIGUOUS_TOKEN、UNKNOWN_VERSION、MIGRATING、UNSUPPORTED_DEX、WRAPPER_INCOMPATIBLE、INCOMPLETE_SNAPSHOT、STALE_QUOTE、SIMULATION_FAILED、WALLET_BLOCKED、EXECUTION_UNKNOWN、PARTIAL_EXECUTION。此分类补充原始错误，不能替代钱包原始错误消息。
