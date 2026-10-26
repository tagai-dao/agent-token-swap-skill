# Repository instructions

## Mandatory Multicall rule

- 批量合约读取必须使用链上 Multicall（如 Multicall3 aggregate3），适用于所有合约、前端、API、服务、脚本、链和 agent。
- Promise.all 包装独立 eth_call、循环 readContract、JSON-RPC batch、关闭 RPC batch 后逐个发送都不算 Multicall，禁止作为实现或降级。
- 有依赖查询分阶段 Multicall；同一快照所有阶段、分片和重试固定同一 blockTag。单个独立合约读取和区块、回执、日志查询不属于批量合约读取。
- 节点 gas、响应大小、数量限制只能通过拆分 Multicall 解决。未部署、调用失败、调用者语义不兼容必须明确报告并解决，不得静默绕过。
- 使用所在链已验证地址和 ABI，保持结果顺序、处理子调用失败，必要数据缺失拒绝整体结果。
- 修改批量读取时，测试必须验证 eth_call 目标为 Multicall、子调用集合和固定区块。
- 此规则由用户明确要求，后续 agent 和子项目不得放宽。

## Product boundaries

- One installable skill; platform-specific instructions live in references/platforms. Keep the user workflow in Chinese and shared machine field names in English.
- BSC only. User provides ticker or address; no proactive token discovery. The agent selects the route unless the user constrained it.
- External launchpad internal markets call platform contracts directly. TagAI uses its version-specific internal / external methods, never ImportedTokenSwapWrapper.
- Other external markets prefer ImportedTokenSwapWrapper; documented incompatibility permits direct DEX execution. Only verified Uniswap / PancakeSwap deployments and supported protocol variants are eligible.
- BNB is the entry / final asset. Platform settlement assets may require sequential swaps; persist progress and never silently repeat a completed leg or spend existing intermediate holdings.

## Integration discipline

- Read SKILL.md and references/integration-contract.md before adding an adapter. Do not invent platform contracts, endpoints, ABI signatures, fee formulas or test results.
- This revision is a framework. Preserve disabled capabilities until the corresponding adapter, verified deployments and behavioral evidence exist. Adding documentation or an ABI alone does not enable production trading.
- Keep source provenance for ABI files. Never copy production credentials, local paths, RPC tokens or private keys into this repository.
- Shared scripts currently run offline and do not sign or broadcast. Introduce RPC / transaction execution only as part of an explicit platform integration.
- Run `npm run validate`, `npm test` and the skill-creator validator for skill changes. For contract batch readers, add transport-level Multicall tests when implemented; documentation checks cannot replace them.
