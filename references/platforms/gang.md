# GANG 平台与中间结算币

## 能力状态

NOT_INTEGRATED。内盘以 GANG 结算来自用户已说明的业务需求；实际 GANG 地址、精度、平台 ABI、结算规则及外盘换币路线尚未核验。不能只凭 symbol=GANG 选资产。当前无法搜索、识别、报价或执行。能力以 [配置](../../config/bsc.json) 为准。

## 本平台路线

```text
内盘买入：BNB → 已核验 GANG → 内盘目标币
内盘卖出：内盘目标币 → 已核验 GANG → BNB
```

内盘步骤直调 GANG 平台合约，不经过 wrapper。中间 GANG 与 BNB 的外盘步骤同其他非 TagAI 外盘：优先 [Wrapper](../imported-token-swap-wrapper.md)，确认不兼容才直调受支持的 [DEX](../external-dex.md)。

目标币已经外盘时按其当前外盘池规划，不机械经过 GANG。只允许已接入的 Uniswap / PancakeSwap 部署，不能因平台结算需要而自动引入其他 DEX。

## 两笔 swap 的准确含义

- 用户表达的是 BNB 买入 / 卖回 BNB，不要求用户自己准备 GANG 或选择 DEX。
- 买入先估算完整报价，BNB→GANG 成功后，以本笔实际净到账重新报价内盘买入。
- 卖出先估算整条链路，目标币→GANG 成功后，以本笔实际净到账重新报价 GANG→BNB。
- 默认不使用原钱包 GANG 持仓；平台调用方、最终接收者和中间资产所有权应保持明确。
- 两笔 swap 之外可能存在 GANG / 目标币 approve；列出实际总步骤，不承诺只会发生两笔链上交易。
- 第一笔成功、第二笔失败会留下 GANG。按 [执行恢复](../execution.md) 标记 PARTIAL，不重复第一笔、不自动回兑、不扩大预算。

## 后续接入资料

需要 ticker 搜索、发行证明与版本、内盘状态 / 进度 / 价格、GANG 合约地址和 decimals、内盘报价 / 买卖 ABI、GANG 结算的 gross / net 口径、真实 spender、收费 / 最小量 / 退款 / 滑点规则、外盘迁移和池数据，以及 BNB↔GANG 的受支持真实路线。

按 [接入契约](../integration-contract.md) 给两个内盘方向及中间换币分别填写方法卡片和验证证据。不能将其他平台 BNB 内盘买入的 msg.value 参数照搬到 GANG 内盘。
