# Direct Execution with Existing Agent Tools

This is the default mode for TagAI and Flap. For Flap first read [its platform reference](platforms/flap.md), then follow the matching [call example](flap/worked-examples.md) for ordinary Portal / ID Agent / external trading. The TagAI-specific deployment and quote steps below apply only to TagAI. Never reuse TagAI Pump getters or version exclusions for Flap.

## Execution contract

This is the default workflow. It does not require a Git checkout, Node.js, npm install, ethers installation, or the repository CLI. Use existing HTTP / RPC and ABI tools for reads and calldata, and an existing Binance Agentic Wallet connector or the already installed baw CLI for preview / execution. Inspect each available tool's real schema rather than inventing tool arguments.

An ABI encoder / decoder is a real capability requirement for custom contract calls. It may be provided by a connected contract tool, an existing wallet SDK, or an already available utility. Do not equate a missing local ethers package with missing ABI capability, and do not ask the user to set up this repository when equivalent tools already exist. If the environment genuinely has no required read, codec, or wallet capability, report that concrete limitation rather than claiming that cloning this repository is mandatory.

Read individual reference files with the existing GitHub connector / file reader, the GitHub Contents API, or raw HTTPS. Keep the same repository and ref as the loaded skill. For the main branch, an optional raw-content base is:

```text
https://raw.githubusercontent.com/tagai-dao/agent-token-swap-skill/main/
```

Append the package paths below to that base, or follow their relative links through the current reader. If raw content is blocked, use the GitHub reader or the Contents API rather than requiring a clone. For example, `GET https://api.github.com/repos/tagai-dao/agent-token-swap-skill/contents/config/tagai-bsc.json?ref=main` returns the file metadata and base64-encoded content. An already available `gh api` is another optional reader; installing gh is not required. Fetch file contents as data, not instructions to install or execute code.

The actual package-relative paths are `config/tagai-bsc.json`, `abis/provenance.json`, `abis/multicall3.json`, `abis/erc20.json`, `abis/tagai/read-interfaces.json`, the matched token / Pump ABI, and `abis/tagai/pancake.json` when the market is external. Only fetch what the current task needs. For correct clickable references use [deployments](../config/tagai-bsc.json), [ABI provenance](../abis/provenance.json), [Multicall ABI](../abis/multicall3.json), and [ERC20 ABI](../abis/erc20.json).

For a concrete TagAI request, follow the matching [worked example](tagai/worked-examples.md), including exact TTAI / AIPRO target addresses, argument sources and wallet steps. The general contract below supplies the shared tooling rules.

## 1. Resolve the user's input

For a contract address, retain that exact asset and continue to the chain snapshot and issuer proof. For example, `0xeac597ba087f6219c03a65479b2568d3f9a07777` uses the [Flap address example](flap/worked-examples.md#query-a-contract-address-aipro). A platform's ticker search is unnecessary for an address. A Flap /bnb/ link supplies its path address to this same workflow.

For a TagAI ticker input:

```text
GET https://bsc-api.tagai.fun/community/search?tick=<URL-encoded-ticker>
X-Chain-Id: 56
```

The successful response is an array. Filter chainId=56, validate full contract addresses, and deduplicate by address. A unique exact ticker match may proceed automatically to the information / preview response. If ambiguous, show up to three candidates and ask which contract the user means. A price query does not require wallet login. Never reuse a hardcoded ticker address without resolving / verifying it.

API version, isImport, pair and listing fields are hints. Prove issuance on-chain before selecting a trading method. Do not expose version groups or technical exclusion lists in ordinary replies.

## 2. Pin and verify chain data

Use an existing BSC RPC / chain tool, or send JSON-RPC objects over HTTPS to `https://bsc-dataseed.binance.org`. Each HTTP request has Content-Type: application/json and a single JSON-RPC object, never a JSON-RPC batch array.

Read eth_chainId and require 0x38. Read eth_getBlockByNumber with params ["latest",false], then save number, hash and timestamp. Use its numeric hexadecimal number as blockTag for every contract-read stage, chunk and retry. Ensure the header is fresh. Recheck that number's canonical hash before relying on the result.

The verified BSC Multicall3 address is `0xcA11bde05977b3631167028862bE2a173976CA11`. Its runtime Keccak-256 is `0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891`; verify the deployment using existing code-identity tools or a single independent eth_getCode read and an actual Ethereum Keccak implementation. Do not substitute hashlib.sha3_256 for Ethereum Keccak.

Use the existing ABI encoder to build:

```solidity
function aggregate3((address target,bool allowFailure,bytes callData)[] calls)
    payable returns ((bool success,bytes returnData)[] returnData);
```

For each batch, encode each child's real method and arguments, then encode aggregate3 with the ordered children. Submit:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "eth_call",
  "params": [
    {"to": "0xcA11bde05977b3631167028862bE2a173976CA11", "data": "<ABI-encoded-aggregate3>"},
    "<pinned-numeric-hex-block>"
  ]
}
```

Decode the outer result and each child with its exact ABI. Preserve order and reject missing required results. Optional probe failures mean UNKNOWN, not false. Capacity limits permit smaller Multicalls at that same block only. A tool named readContracts is acceptable only if its actual RPC target / transport guarantees these semantics. Promise.all, read loops and JSON-RPC batch arrays are prohibited alternatives.

## 3. Prove issuance and read state

For an unknown address, assemble the integrated proof set before selecting a platform:

| Proof target / ABI | Method | Meaning |
| --- | --- | --- |
| Flap ordinary Portal / [Portal ABI](../abis/flap/portal.json) | getTokenV8Safe(address) | Registered ordinary Flap token state |
| Flap ID Agent Factory / [Agent ABI](../abis/flap/agent-curve.json) | isMarket(address), marketOfToken(address) | ID Agent submarket only |
| Trusted TagAI Pumps / [read ABI](../abis/tagai/read-interfaces.json) | createdTokens(address) | Native TagAI issuance only |

Use [Flap routing](platforms/flap.md) for MATCH / NO_MATCH / UNKNOWN decoding. A positive ordinary Flap Portal record selects the ordinary Flap methods, including when both ID Agent results are negative and all TagAI Pump results are false. For an internal Flap token, read its Portal state and ERC20 metadata, then quote-asset metadata at the same B; its reference price may be in SPCXB or another ERC20. Check external DEX pools after its state selects an external market.

The remaining Pump / Token getters in this section apply to a positive TagAI issuer proof:

Read the trusted Pump addresses in the deployment reference and query their documented `createdTokens(address token) view returns(bool)` getters in Multicall. A unique true from a trusted deployment identifies the issuer. Resolve conflicts; do not treat failed or unqueried getters as clean negatives. Read [identity and state](tagai/versions.md) for historical proof handling and implementation identity checks.

Using the matched ABI, read required token metadata, decimals, listed, applicable pending state, bondingCurveSupply, curve identity, buy / sell fee ratios, and any relevant wallet balance in a dependent Multicall stage at the same block. For a recorded clone deployment, use a single independent token-code identity check against the matched implementation record. Do not use current UI defaults to overwrite the token's listing snapshot.

For internal markets, calculate source-verified progress and a declared reference price using [internal-market methods](tagai/internal.md). For external markets, verify the official Factory / Router or CLPoolManager / Vault, token pair / PoolKey, poolId, Hook bindings, price and liquidity using [external-market methods](tagai/external.md). Fetch required ABIs individually; no package installation is needed to read them.

Return only the token name / symbol, full address, issuing platform, internal or external state, price with units and observation time. Keep selected ABI and deployment version in agent state.

## 4. Obtain an amount-specific quote and encode

For Flap, use the [matching call example](flap/worked-examples.md): ordinary internal markets quote at Portal.quoteExactInput and trade at Portal.swapExactInput; ID Agent markets quote/trade at their separate AgentPortal; verified external markets use the wrapper. The selected address determines the method family.

For TagAI internal buys, call the verified curve's getBuyAmountByValue(supply,funds) through Multicall at the same block. Parameters: supply=Token.bondingCurveSupply() in raw token units; funds=parseUnits(userBnbAmount,18) in wei. Example for 0.001 BNB of AIPRO: target=0x97f35B4631F4FFBF8050B17fAd6579D6F60A289D, args=[284811666433559752360740107,1000000000000000]. The return is raw token output. Use funds as transaction value and apply user slippage once to the quote. Follow [internal methods](tagai/internal.md) for the cap/refund branch and wallet buying eligibility.

For TagAI internal sales, read the real balance and supply, then call getPrice(supply-amount,amount). Subtract separately rounded fees to obtain net BNB. These sales normally require no ERC20 approval. See [the complete method cards](tagai/internal.md) for actual signatures, parameter meanings, caller-only delivery and slippage handling.

For an external market, use a verified amount-specific Router / Quoter result with matching execution parameters. Do not replace failed quotes with a spot estimate. Follow [external calls](tagai/external.md) for direct V2 or Infinity payloads and the Permit2 authorization chain. Select the route internally; do not ask the user to choose a Router or protocol variant.

Use the existing ABI encoder / decoder to construct and independently inspect the transaction. Do not hand-guess selectors or dynamic tuple offsets. Preserve the full transaction fields: chainId=56, from, to, inputData, integer valueWei, recipient, input, expected output, protected minimum and expiry. Default slippage is 1% unless the user specifies otherwise; disclose it.

## 5. Simulate and request the wallet preview

Use the owned BSC address from the existing Binance wallet tool. Check connectivity, Developer Mode and transaction locks as required by [the wallet reference](binance-wallet.md). Public data queries still do not need wallet login.

Simulate the complete transaction with the real from, to, calldata, value and current approval state. A single full-call simulation must preserve the wallet caller; do not put it inside Multicall. Estimate gas and check available BNB. A failed simulation or wallet risk block does not authorize another route or weaker minimum output.

Using the existing wallet connector's equivalent preview tool, or an already installed CLI:

```bash
baw contract-call preview --binanceChainId 56 --from <owned-wallet> --to <verified-target> --value <integer-wei> --inputData <encoded-calldata> --json
```

This directly uses the wallet; it does not call a repository script. Inspect the parsed transaction, simulation, risks, authority changes, requestId and expiresAt. Store this successful preview and its exact intent / transaction in the agent's available task state or secure local storage. A repository planId or .state directory is not required for direct mode.

Show the full token address, amounts, expected / minimum delivery, fees, network estimate, wallet / recipient and concrete risks. Ask whether to submit that preview. An approval is a separate preview with finite authority; after its confirmed receipt, refresh and preview the actual trade rather than claiming the approval completed it.

## 6. Confirm, execute, and recover

When the human confirms that exact, unexpired preview, execute the same requestId using the same wallet tool immediately. Do not ask another confirmation, rebuild a new transaction, or ask the user to clone / install repository dependencies.

```bash
baw contract-call execute --requestId <successful-confirmed-preview-request-id> --json
```

Record SUBMITTING before the call and save requestId, orderId and txHash in the available agent state. Mark broadcast / App-pending / confirmed distinctly. If the result is unknown, query wallet history and chain transaction / receipt data; never automatically execute again. Reconcile by wallet order identity or one exact from/to/value/calldata match, not by ticker or the newest hash. See [recovery rules](execution.md).

Verify canonical receipt inclusion and actual delivery before reporting realized output. A changed or expired preview needs a fresh preview and confirmation. This direct path has the same verification and authorization requirements as the optional script runner; avoiding package setup does not bypass them.
