# 批量合约读取

## 用户强制规则

所有批量合约读取使用所在链已核验的 Multicall，例如 Multicall3 `aggregate3`。多个独立 eth_call 的 Promise.all、循环 readContract、JSON-RPC batch、关闭 batch 后逐个发送都不是替代方案。

1. 验证 RPC chainId=56。读取区块头，固定 `blockNumber` 并记录 `blockHash`。
2. 使用 config/bsc.json 中已验证的 Multicall 地址和 [ABI](../abis/multicall3.json)。目前地址为空，不能启动链上读取。
3. 将 target、callData、allowFailure 按稳定顺序编码进同一次 aggregate3，外层 `eth_call.to` 必须是 Multicall 地址，blockTag 必须为固定区块。
4. 依赖查询在后续阶段再次使用 Multicall，区块不变。节点容量限制只允许分片 Multicall，所有分片和重试区块不变。
5. 根据索引恢复结果并验证长度、成功标志和解码。可以让可选字段失败，但归属、交易状态、配置、余额、授权、执行报价等本次决策必需项失败则拒绝整体结果，不拼凑其他快照数据。
6. 检查重组；同高度 hash 变化使快照失效，需要重新开始，而不是继续混用。

## 调用者与非 view 报价

Multicall 子调用中的 msg.sender 是 Multicall，不是原钱包。账户参数显式传给 balanceOf/allowance 等方法。不能用该快照替代依赖真实调用者的完整交易模拟。调用者语义不兼容必须明确报告并实现合规适配，不能退回多个独立 eth_call。

aggregate3 本身是 payable / 非 view，使用外层 eth_call 执行，绝不广播；底层采用 CALL。部分 Quoter / wrapper 报价方法非 view，不能擅自改 ABI 或用 STATICCALL 假设其可读。非 view 子调用可能临时改变同一 aggregate 内后续观察到的状态，必须确认报价无持久临时污染，必要时拆到独立 Multicall 分片，仍固定同一区块。

单个独立合约读取、区块、回执、日志读取不属于批量读取。不能把本应批量的查询拆成“单次独立”规避规则。

## 接入时必须增加的测试

- 拦截实际 RPC 传输，验证所有批量 eth_call.to 是核验的 Multicall。
- 解码 aggregate3，验证 targets、完整子调用集合、顺序、allowFailure 和账户参数。
- 依赖阶段、分片及重试验证固定 blockTag；重组后整个快照重新开始。
- 必需调用失败、缺失、解码失败拒绝结果，可选字段失败明确标注。
- 不允许容量错误触发独立合约调用降级。

目前没有 RPC 读取实现；离线仓库校验不代表上述传输测试已完成。
