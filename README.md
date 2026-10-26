# Agent Token Swap Skill

面向 Binance Agentic Wallet 的 BSC 代币交易 skill。用户指定 ticker 或合约地址，由 agent 识别平台、内外盘和版本，规划 BNB 买入或卖回 BNB 的路线。

**当前版本：框架，尚不能查询真实平台数据或执行交易。** Flap、Fourme、TagAI、GANG 待后续逐个平台接入。仓库根目录是一个完整 skill 包，入口为 [SKILL.md](SKILL.md)；平台文件属于该 skill，无需分别安装。

## 内容

- `references/platforms/`：各平台的独立交易指引和待接入范围。
- `references/`：代币解析、DEX / wrapper、Multicall、钱包及多步恢复约定。
- `abis/`：共享 ABI 与来源记录，存在 ABI 不表示部署已启用。
- `config/bsc.json`：链、平台能力和部署核验状态。
- `scripts/trade.mjs`：离线查看能力及校验仓库，不连接钱包或 RPC。

## 本地检查

需要 Node.js 22 或更高版本，无第三方运行时依赖，无需 npm install：

```bash
node scripts/trade.mjs capabilities
npm run validate
npm test
```

新平台接入遵循 [接入契约](references/integration-contract.md)。本阶段不自动安装到本机 agent，也不要求连接钱包。
