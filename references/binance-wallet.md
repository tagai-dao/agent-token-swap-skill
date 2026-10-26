# Binance Agentic Wallet

This reference was adapted from the locally available Binance Agentic Wallet skill v1.13.0, which documents a minimum CLI version of 1.11.0. Verify the actual CLI version and `--help` when implementing integration. Stop on interface mismatches instead of guessing commands. Upstream: [binance/binance-skills-hub](https://github.com/binance/binance-skills-hub). Reading framework documentation does not require the user to sign in or install the CLI.

## Before live wallet operations

Use signing capabilities managed by `baw` only. Do not request private keys, seed phrases, or session tokens, or export credentials. Append `--json` to commands and remove sensitive fields before display.

```bash
baw cli-check --required-version 1.11.0 --json
baw wallet status --json
baw wallet address --json
baw wallet settings --json
baw wallet tx-lock --json
```

Verify CONNECTED status, the BSC wallet address, balances and gas, trading restrictions, and pending transactions. For a disconnected wallet, use the installed Binance wallet skill's authentication guidance or current CLI help; do not invent authentication parameters. Custom contract calls require `devMode.enabled=true`. Otherwise instruct the user to enable it in the Binance App; do not enable it on their behalf.

## Construction and preview

The following illustrates parameter syntax, not an executable transaction:

```bash
baw contract-call preview \
  --binanceChainId 56 \
  --from <owned-bsc-wallet> \
  --to <verified-target> \
  --value <integer-wei> \
  --inputData <encoded-calldata> \
  --json
```

`--value` is integer wei, not human-readable BNB. Use value=0 for nonpayable calls and ERC20 approvals. Match from, to, calldata, and value exactly to the plan. Let the backend estimate gas by default. Do not guess gas-price parameters; use a custom gasLimit only when explicitly requested by the user and supported by the current CLI.

Require a successful preview, a valid requestId, and checks of expiresAt, parsedTx, simulationResult, risks, and authorityChanges. Verify the token, direction, amount, recipient, spender, and approval amount. For complex calldata the wallet does not fully parse, also decode locally with the matching ABI and verify simulated asset changes.

Show the preview, risks, authority changes, and human-readable amounts, then obtain explicit confirmation before execution. Backend requireConfirmation=false does not mean the user has confirmed. Upstream requires confirmation after an external-signing preview; this framework does not preauthorize live transactions.

## Execution and results

```bash
baw contract-call execute --requestId <successful-preview-request-id> --json
```

Execute only the requestId from that successful preview. Do not execute failed, blocked, expired, or changed previews. Rebuild / preview and confirm the new contents as needed rather than reusing an old ID.

- BROADCASTED: save orderId and txHash, then check the receipt.
- PENDING_CONFIRMATION: save orderId and wait for the Binance App. Do not treat it as success or execute again.
- Errors: show the original error code and message. Explain separately established facts without speculating about the cause.

Implement order queries and hash recovery after App confirmation from current CLI documentation when adding the executor. No runnable polling script is included yet. See [execution recovery](execution.md).

This skill builds calls for the selected platform / DEX. Do not use `market-order swap` to bypass route constraints or a failed custom call. Do not evade wallet risk blocks through another entry point.
