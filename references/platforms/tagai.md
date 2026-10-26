# TagAI 平台及版本路由

## 能力状态

NOT_INTEGRATED。当前仓库没有导入完整的 TagAI 版本 ABI、发行归属映射、DEX 部署和已验证路由，不执行真实查询或交易。已有主项目代码可以作为后续接入资料，但其本地配置不能自动视为本 skill 已核验部署。能力以 [配置](../../config/bsc.json) 为准。

## 身份与版本

TagAI 原生发行币必须有对应 Pump / Factory / Registry 的链上发行证明。用户选择“TagAI”或外部代币绑定了 TagAI Community 都不等于 TagAI 原生发行。

按固定区块 Multicall 先查发行归属，再查版本特有状态。明确 Pump、Token implementation、上市快照、Hook、Manager、结算资产的对应关系；未知版本不套最新版本 ABI。多 Pump 支持不能只通过某个兼容旧 getter 推断全部支持范围。

## 本平台路线

- 内盘：直接使用该版本的 Token / 平台交易方法，不走 wrapper。
- 外盘：使用该版本要求的 DEX 入口和配套交易方法，不走 ImportedTokenSwapWrapper；不把第三方平台的 wrapper fallback 规则套在 TagAI 原生币上。
- “直接 DEX”指按已核验的 Router / Manager / 回调执行入口交易，不是把钱包交易直接发给裸 pool、vault callback 或任意 helper。
- 如某版本需要专门的 TagAI 交易执行器处理 Hook / 组件路线，其准确身份、DEX 执行语义及是否符合用户指定方式必须在该版本调用卡片中写清，不能静默复用历史 executor。
- BNB 是统一入口和最终输出；组件 / 中转资产与多池拆分由对应版本规则决定，不能让用户猜路线。

## 必须补齐的版本矩阵

每个支持版本都需记录以下列，目前没有启用任何一行：

| 项目 | 必须描述 |
| --- | --- |
| 版本识别 | 发行 Pump / implementation 与证明方法 |
| 内盘方法 | 真实签名、报价、费用、滑点字段、msg.value、授权需求 |
| 迁移状态 | listed / pending 等真实字段语义，以及各方向是否允许交易 |
| 上市池 | DEX 协议、PoolKey / poolId、native / wrapped、Manager、Hook 快照 |
| 外盘买卖 | 真实 ABI、spender、收款人、Hook 数据、退款和最小到账 |
| 多池 / 组件 | 是否支持、候选来源、税、执行顺序与中转路径 |
| 价格与进度 | 精确公式、净输出口径与数据来源 |
| 行为证据 | 相应版本双向交易、迁移边界、费用 / Hook 验证 |

上市 PoolKey 或 Hook 应以代币实际绑定快照为准，不使用“当前最新 Hook”覆盖老币。Uniswap / Pancake 的不同池结构和 hookData 编码分别记录；计费主体参数（subject / sellsman 等）不是 router 或 recipient。

## 后续接入

先按 [接入契约](../integration-contract.md) 选择明确的版本范围，补源码 / ABI / 部署来源、发行证明、内盘方法，再补外盘各变体。进度、价格与成交报价不能只从旧 UI 的展示逻辑推断。未知版本或用户路线不兼容时停止并说明，不回退 wrapper。
