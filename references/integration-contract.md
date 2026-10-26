# 平台接入契约

后续每个平台作为独立接入任务，先读对应平台文档；没有用户提供或可信来源的 ABI / 地址不实现交易。主 SKILL.md、配置与本文必须保持一致。

## 平台文档必须填写的内容

1. 官方资料、BSC 部署、版本、代理关系、部署 / 核验来源及日期。
2. ticker 查询接口、参数、分页、排序、响应样例、失败语义。
3. 发行证明 getter / Registry / Factory 及 ABI，MATCH / NO_MATCH / UNKNOWN 规则。
4. 内外盘、迁移、买卖开关、进度原始数据与公式、参考价及计价币。
5. 内盘结算币、报价、买卖、授权和事件 / custom errors。
6. 各版本外盘池数据取得方式；TagAI 必须单独列版本路由。
7. 金额相关报价、所有费用、动态税、用户最终最低到账的具体含义。
8. 真正的 BNB 双向路线、必要中间兑换、授权数量和失败恢复。

## 每个合约方法的调用卡片

包含完整 Solidity 签名、精确 JSON ABI、stateMutability、selector（从 ABI 计算）、to、from、msg.value、spender、每个参数的类型 / 单位 / 含义 / 数据来源 / 有效范围、tuple 的严格字段顺序及编码方法、返回值解码、费用是否已扣、前置状态、事件与错误、真实 from 的模拟方式。

给出至少一个确定输入的 calldata 编码 / 反解样例，不能手写猜 selector。报价若非 view，保留真实 mutability 并通过 eth_call 调用，不广播报价。区分 amountOut 的 gross / net / recipient 最终到账。

## 接入代码边界

平台适配器负责 search、buildProvenanceCalls、decodeProvenance、buildStateCalls、decodeState、报价与内盘 calldata 构造。共同层负责固定区块 Multicall、DEX / wrapper、钱包及执行记录；不让各平台各写一套独立 RPC。

执行器是待实现能力，scripts/trade.mjs 当前只支持 capabilities / validate。增加实际命令时必须实现能力门控及对应测试；不能通过把 config.status 改成 ready 来启用不存在的方法。

## 地址与 ABI 核验

部署证据至少记录 chainId、地址、版本、核验时间 / 区块、代码或代理实现身份、来源、ABI SHA-256。ABI 从匹配源码编译产物 / 已验证官方资料取得。运行时代码有 immutable / proxy 时正确处理，不要求未经归一化的 artifact 字节码直接相等。

DEX 以具体部署条目注册：品牌只能 uniswap / pancake，协议版本、Factory / Router / Quoter / Manager / Vault / wrappedNative 及支持方向明确。wrapper 部署、真实 ABI、费率、中转路由核验独立记录，不把本地源码支持范围当成线上部署保证。

## 启用验收

- 识别成功、明确否定、查询失败、未知版本、平台冲突和导入币归属区分。
- ticker 同名候选、不完整搜索覆盖、用户路线约束。
- 内盘买卖、迁移边界、外盘买卖，BNB 双向完整路线。
- 授权 spender、先归零行为、税币 / Hook 支持方向、费用和最终最低到账。
- Multicall 传输目标、子调用和固定区块，失败拒绝 / 分片 / 重试 / 重组。
- 报价池和实际执行池一致，完整 calldata 反解及真实钱包模拟。
- 多步实际到账、失败保留中间资产、广播不明不重复交易、App 待确认恢复。
- 默认以单元测试和固定区块 fork 验证，不发送真实资金。真实主网交易必须另有用户授权。

证据完备后，随适配实现、测试和文档一起更新 capabilities，明确哪些版本和方向启用。当前框架所有交易能力保持关闭。
