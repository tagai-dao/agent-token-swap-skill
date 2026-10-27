# Agent Token Swap Skill

Look up BSC tokens and trade through Binance Agentic Wallet. The user supplies a ticker or contract address; the agent identifies the issuing platform, price and market, prepares a wallet preview, and submits it after confirmation.

## Default use: existing agent tools

Give the agent [SKILL.md](SKILL.md). The default workflow uses its existing HTTP / JSON-RPC, ABI encoding / decoding, simulation and Binance wallet tools. Read the needed reference files and ABIs over HTTPS. **A repository clone, Node.js, npm dependencies and repository scripts are not trading prerequisites.** Users should not be asked to set up this project merely to get a quote or confirm a trade.

See [direct tool execution](references/tool-native.md) for the complete route from ticker lookup through Multicall, quoting, wallet preview and confirmed execution. Actual wallet / chain capabilities are still required; use what the agent already has rather than assuming a particular local SDK.

TagAI and Flap workflows are connected. Flap covers ordinary Portal internal trading, ID Agent native-BNB share buys / percentage sales, and verified Pancake V2/WBNB external pools through ImportedTokenSwapWrapper. Read [Flap coverage](references/platforms/flap.md) for remaining token-specific routes. Fourme / GANG are added separately. Contract versions, ABI selection and routing details stay internal to the agent. Answer users in their preferred language while keeping repository-authored instructions in English.

For concrete TagAI operations, read [worked examples](references/tagai/worked-examples.md): TTAI candidate lookup / price, 0.001 BNB external buy, 1000-token sale and AIPRO internal buy/sell. Every example specifies contracts, ABI calls, argument units and wallet preview steps; historical observations must be refreshed.

## Optional repository automation

Agents with a checkout may use the script runner as a convenience. Only this optional runner requires Node.js 22+ and its locked dependencies:

```bash
npm ci --ignore-scripts
node scripts/trade.mjs info --token AIPRO
node scripts/trade.mjs quote --token AIPRO --side sell --amount 1000
node scripts/trade.mjs prepare --token AIPRO --side sell --amount 1000
# Only after the human confirms that specific preview:
node scripts/trade.mjs execute --plan <plan-id> --confirmed
node scripts/trade.mjs status --plan <plan-id>
```

See [script operations](references/runtime.md). Low-level `scripts/tagai.mjs` helpers are also optional; their offline-only behavior does not limit the direct tool workflow.

## Development

```bash
npm run validate
npm test
```

[Platform references](references/platforms/tagai.md) and [ABI provenance](abis/provenance.json) contain implementation details. Tests cover Multicall transport, quotes and mocked wallet submission. Real token search and quotes have read-only smoke coverage; development does not broadcast real trades.
