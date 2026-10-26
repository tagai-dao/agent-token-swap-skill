# Agent Token Swap Skill

A BSC token trading skill for Binance Agentic Wallet. The user supplies a ticker or contract address; the agent identifies the issuer, market phase, and version, then plans a BNB-funded buy or a sale back to BNB.

**Current release: TagAI interaction documentation and offline preparation.** TagAI now has versioned ABIs, issuance / internal / external call guides, and deterministic calldata / Multicall helpers. V5 and V8 are excluded. Bundled live search, quoting, and wallet execution are not implemented; Flap, Fourme, and GANG remain unintegrated. The repository root is one installable skill package, with [SKILL.md](SKILL.md) as its entry point. Platform references are part of this skill and do not require separate installation.

## Contents

- `references/platforms/`: platform-specific trading instructions and integration requirements.
- `references/`: token resolution, DEX / wrapper routing, Multicall, wallet execution, and multi-step recovery.
- `abis/`: shared ABIs and provenance. Including an ABI does not enable its deployment.
- `config/bsc.json`: chain configuration, platform capabilities, and deployment verification status.
- `scripts/trade.mjs`: offline capability inspection and repository validation.
- `scripts/tagai.mjs`: source deployment references, fixed-block Multicall requests / decoding, and version-specific unsigned calldata; no wallet or RPC access. See [TagAI tools](references/tagai/tools.md).

## Local checks

Requires Node.js 22 or newer. Install the locked ethers dependency before running the tools:

```bash
npm ci
node scripts/trade.mjs capabilities
node scripts/tagai.mjs deployments
npm run validate
npm test
```

Follow the [integration contract](references/integration-contract.md) when adding a platform. This stage does not install the skill into a local agent or require a wallet connection. Maintain repository-authored instructions, documentation, metadata, and code comments in English.
