# Agent Token Swap Skill

Look up BSC tokens and trade through Binance Agentic Wallet. The user supplies a ticker or contract address; the agent identifies the issuing platform, current price and market, prepares a transaction preview, and submits it after confirmation.

The TagAI adapter includes live token search, fixed-block Multicall reads, price and amount-specific quotes, transaction simulation, Binance previews, submission and receipt tracking. Other platform adapters are added separately. Routing and contract-version details stay internal to the agent.

## Use

Requires Node.js 22+. Querying prices does not require a connected wallet; trading uses the installed `baw` CLI and the user's Binance wallet.

```bash
npm ci --ignore-scripts
node scripts/trade.mjs info --token AIPRO
node scripts/trade.mjs quote --token AIPRO --side sell --amount 1000
node scripts/trade.mjs prepare --token AIPRO --side sell --amount 1000
# Only after the human confirms that specific preview:
node scripts/trade.mjs execute --plan <plan-id> --confirmed
node scripts/trade.mjs status --plan <plan-id>
```

Give an agent [SKILL.md](SKILL.md) as the entry point and make the complete repository available. See [runtime operations](references/runtime.md) for command behavior and recovery. Endpoint overrides are optional through BSC_RPC_URL / TAGAI_API_URL; defaults are supplied.

## Development

```bash
npm run validate
npm test
```

[Platform references](references/platforms/tagai.md) and [ABI provenance](abis/provenance.json) contain implementation details. `scripts/tagai.mjs` remains an auxiliary offline encoding tool; normal operations use `scripts/trade.mjs`. Runtime tests cover Multicall transport, quotes and mocked wallet submission. Real token search and quotes have read-only smoke coverage; development does not broadcast real trades.

All repository-authored instructions, documentation, metadata, and code comments are maintained in English. Agents should answer users in their preferred language.
