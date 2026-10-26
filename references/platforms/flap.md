# Flap 平台

## 能力状态

NOT_INTEGRATED。官方接入文档、BSC 合约地址、版本和 ABI 尚未提供。当前不支持实际 ticker 搜索、发行归属判定、状态读取、报价或交易；不得猜方法名、接口或进度公式。能力以 [配置](../../config/bsc.json) 为准。

## 本平台路线

- 内盘：直接调用 Flap 对应版本合约，不走 ImportedTokenSwapWrapper。
- 外盘：读取 [DEX](../external-dex.md)，优先 [ImportedTokenSwapWrapper](../imported-token-swap-wrapper.md)；确认不兼容时可走已接入的直接 DEX。
- 买入从 BNB 开始，卖出最终回到 BNB。实际内盘结算币待官方资料确认，需要中间币时按 [执行文档](../execution.md) 拆步骤。
- 用户指定 Flap 时先验证 Flap 发行归属；没有指定时参与固定区块 Multicall 归属检测。迁移中不自动重试内盘或抢先外盘交易。

## 后续接入资料

| 项目 | 当前情况与要求 |
| --- | --- |
| ticker 查询 | 接口、排序、分页、字段及真实响应未接入 |
| 发行归属 | 提供官方 Factory / Registry getter 的精确 ABI、地址和否定语义 |
| 合约版本 | 提供不同版本的识别依据、地址与支持边界 |
| 市场状态 | 提供内盘 / 迁移 / 外盘和买卖开关方法 |
| 价格与进度 | 提供原始字段、单位、毕业条件、费用和公式 |
| 内盘报价 | 提供买卖方向、结算币、gross / net 口径及报价 ABI |
| 内盘买卖 | 提供完整 ABI、msg.value、spender、recipient、滑点参数和事件 |
| 上市后池信息 | 提供毕业事件或 getter、DEX / PoolKey / 池地址取得方式 |
| 验证证据 | 已验证源码、交易样例、固定区块 fork / 单元测试 |

按 [接入契约](../integration-contract.md) 为每个方法填写调用卡片，提交真实 ABI 后才能增加调用示例。不能把 wrapper ABI 用作 Flap 内盘 ABI。
