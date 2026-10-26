# Binance Agentic Wallet

本文件基于本地 Binance Agentic Wallet skill v1.13.0 的文档整理，记录的最低 CLI 版本为 1.11.0。实现接入时应核对实际 CLI 版本与 `--help`，接口不匹配时停止，不能猜命令。上游：[binance/binance-skills-hub](https://github.com/binance/binance-skills-hub)。框架阶段不要为了读本文要求用户登录或安装 CLI。

## 开始真实钱包操作前

只使用 `baw` 管理的签名能力，不索取私钥、助记词、session token，不导出凭据。所有命令带 `--json`，展示前去除敏感字段。

```bash
baw cli-check --required-version 1.11.0 --json
baw wallet status --json
baw wallet address --json
baw wallet settings --json
baw wallet tx-lock --json
```

核验 CONNECTED、BSC 钱包地址、余额与 gas、交易限制及待处理交易。未连接时使用已安装的 Binance 钱包 skill 登录指引或当前 CLI 帮助；不编造认证参数。自定义合约调用要求 `devMode.enabled=true`，否则提示用户在 Binance App 开启，不能自行替用户启用。

## 构造及预览

以下是参数语法示例，不是可直接执行的交易：

```bash
baw contract-call preview \
  --binanceChainId 56 \
  --from <owned-bsc-wallet> \
  --to <verified-target> \
  --value <integer-wei> \
  --inputData <encoded-calldata> \
  --json
```

`--value` 是 wei 整数，不是人类 BNB 数量。非 payable 调用和 ERC20 approve 的 value 为 0。from、to、calldata、value 与交易计划严格一致。默认让后端估算 gas；不猜 gas-price 参数，仅在用户明确指定且当前 CLI 支持时使用自定义 gasLimit。

必须检查 preview 成功、有效 requestId、expiresAt、parsedTx、simulationResult、risks 和 authorityChanges。检查被解析的 token、方向、金额、收款人、授权对象与额度；钱包未完整解析的复杂 calldata 还需本地用匹配 ABI 反解并核对模拟资产变化。

把预览结果、风险、授权变化和人类单位的金额展示给用户，取得明确确认后执行；不能把后端 requireConfirmation=false 当成人类已确认。上游明确要求外部签名 preview 后确认；框架不预先批准任何真实交易。

## 执行与结果

```bash
baw contract-call execute --requestId <successful-preview-request-id> --json
```

只执行该次成功 preview 的 requestId。预览失败、风险阻断、过期、参数变化不 execute；重新构建 / preview 后按新内容确认，不重用旧 ID。

- BROADCASTED：保存 orderId 和 txHash，后续查回执。
- PENDING_CONFIRMATION：保存 orderId 并等待 Binance App，不视为成功，不重复执行。
- 返回错误：原样展示错误码及错误消息，另行说明已确认的事实，不猜测错误原因。

订单查询和 App 确认后的哈希恢复接口在执行器接入时依据当前 CLI 文档实现；目前没有提供可运行的轮询脚本。恢复要求见 [执行文档](execution.md)。

本 skill 构造指定平台 / DEX 的合约调用，不把 `market-order swap` 当作绕过用户路线或自定义合约失败的兜底。钱包风险阻断不能通过其他入口绕过。
