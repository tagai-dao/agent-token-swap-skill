# Agent Token Swap Skill

A BSC token trading skill for Binance Agentic Wallet. The user supplies a ticker or contract address; the agent identifies the issuer, market phase, and version, then plans a BNB-funded buy or a sale back to BNB.

**Current release: framework only. Live platform queries and trading are not implemented.** Flap, Fourme, TagAI, and GANG will be integrated individually. The repository root is one installable skill package, with [SKILL.md](SKILL.md) as its entry point. Platform references are part of this skill and do not require separate installation.

## Contents

- `references/platforms/`: platform-specific trading instructions and integration requirements.
- `references/`: token resolution, DEX / wrapper routing, Multicall, wallet execution, and multi-step recovery.
- `abis/`: shared ABIs and provenance. Including an ABI does not enable its deployment.
- `config/bsc.json`: chain configuration, platform capabilities, and deployment verification status.
- `scripts/trade.mjs`: offline capability inspection and repository validation; no wallet or RPC access.

## Local checks

Requires Node.js 22 or newer. No third-party runtime dependencies or npm install are needed:

```bash
node scripts/trade.mjs capabilities
npm run validate
npm test
```

Follow the [integration contract](references/integration-contract.md) when adding a platform. This stage does not install the skill into a local agent or require a wallet connection. Maintain repository-authored instructions, documentation, metadata, and code comments in English.
