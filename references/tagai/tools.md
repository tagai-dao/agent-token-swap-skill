# Offline TagAI Interaction Tools

Install the locked dependency set with `npm ci`. These tools use ethers for exact ABI encoding, decoding, and nested tuples. They never contact RPC, API, or wallet endpoints and never sign or broadcast. Run from any working directory using the actual script path. All amounts in request files are decimal base-unit strings, not JSON numbers.

## Deployment reference

```bash
node scripts/tagai.mjs deployments
```

Returns the BSC-only source registry, version mapping, excluded V5 / V8 releases, and infrastructure addresses. `productionVerified=false` is intentional. A locally known address is not a fresh runtime verification.

## Prepare a fixed-block Multicall request

Write an issuance request after obtaining the chainId and block header. The example token is synthetic and must be replaced by the user's confirmed token; the blockTag is an encoding fixture, not a current quote block.

```json
{
  "chainId": 56,
  "stage": "issuance",
  "token": "0x1111111111111111111111111111111111111111",
  "blockTag": "0x123456"
}
```

```bash
node scripts/tagai.mjs read-plan request.json
```

The output is `{success,data}`. `data.rpc` is a single JSON-RPC eth_call object whose target is Multicall3 and whose data encodes aggregate3. Submit that object through an available trusted RPC tool only after verifying the Multicall deployment. Do not submit the outer CLI envelope, a JSON-RPC array, or independent child calls. Preserve `data` as the decoding plan. The tool rejects latest/pending, more than 100 child calls, and transaction / approval methods in read batches. Split larger batches into multiple Multicalls with the same blockTag.

For state, fee, eligibility, balance, allowance, or quote stages, explicitly provide `calls`:

```json
{
  "chainId": 56,
  "blockTag": "0x123456",
  "calls": [
    {
      "label": "listed",
      "abi": "abis/tagai/token-v16.json",
      "target": "0x1111111111111111111111111111111111111111",
      "method": "listed",
      "args": [],
      "required": true
    },
    {
      "label": "buyerHandle",
      "abi": "abis/tagai/read-interfaces.json",
      "target": "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
      "method": "handleOf",
      "args": ["0x2222222222222222222222222222222222222222"],
      "required": true
    }
  ]
}
```

The synthetic addresses are encoding examples, not trade targets. Add the complete required state from the version guide. A non-view quote may be included only for the documented quote methods; account for temporary state and caller semantics. Every dependent stage keeps the same numeric blockTag.

## Decode a Multicall result

Save `{"plan": <the previous data object>, "result": "<RPC result hex>"}` and run:

```bash
node scripts/tagai.mjs decode-read response.json
```

The helper verifies the request payload against the recorded call list, result length, subcall success, and decoding. A required failure rejects the whole output. Optional failures become UNKNOWN, never false. A successful issuance boolean still requires interpretation: false is NO_MATCH for that Pump, true is a positive proof. Incomplete historical coverage is reported separately and cannot establish an all-platform negative.

This is an offline decoder, not an authenticity check on user-supplied JSON or proof of current state. Validate the real RPC block hash and provenance independently.

## Encode an internal buy or sale

```json
{
  "chainId": 56,
  "kind": "internal",
  "version": "16",
  "side": "buy",
  "wallet": "0x2222222222222222222222222222222222222222",
  "token": "0x1111111111111111111111111111111111111111",
  "amountIn": "1000000000000000",
  "quoteOut": "1000000000000000000",
  "slippageBps": 100
}
```

```bash
node scripts/tagai.mjs encode request.json
```

For a buy, amountIn is gross BNB wei and quoteOut is expected token units. For a sale use side=sell, token amountIn, and net BNB quoteOut. The helper selects the exact version ABI, handles V1's fourth receiver argument, calculates protection once, rejects V5 / V8, and reports the Handle requirement for V15 / V15-2 / V16 buys. Read the internal guide before using zero-slippage adjustment on legacy contracts.

For every encoded transaction, output includes `from`, `to`, `valueWei`, `inputData`, signature, selector, decoded arguments, minimumOut when applicable, and remaining verification prerequisites. `readyToSend=false` means offline construction alone is not execution authorization or a verified quote.

## Encode an external swap

For V1-V4 use kind=v2 and add deadline as a future Unix-second integer. amountIn and quoteOut follow the same direction-dependent units. For Infinity versions use kind=infinity, a future deadline, and the verified `poolKey` object with currency0, currency1, hooks, poolManager, fee, and parameters. Use an explicit subject only if established by user intent or trusted configuration; otherwise the helper uses zero / empty hookData.

The encoder only supports the native main pool, canonical manager, and registered Hook when available. It rejects a different recipient because this TAKE_ALL sequence pays the caller. Review the returned poolId, commands=0x10, actions=0x060c0f, and ABI-decoded nested payload against [external calls](external.md). Never fill PoolKey fields from guessed defaults.

## Finite approvals

Use kind=erc20-approval, chainId=56, wallet, token, amountIn, and spender. Allowed spenders are the configured V2 Router or Permit2. Approve exactly the required amount; amountIn="0" may be used for an explicitly needed allowance reset.

Use kind=permit2-approval, chainId=56, wallet, token, amountIn, and expiration in Unix seconds. The target is Permit2 and its spender is UniversalRouter. Keep expiration bounded and later than the intended swap deadline. This is an on-chain Permit2 approve call, not an EIP-712 signature or unlimited grant.

## Wallet handoff

Do not execute an encoded fixture. Recheck live issuance / exclusions, market state, balance / allowance, fees, and a real amount-specific quote, then simulate from the owned wallet. Only after these checks use the returned transaction fields in `baw contract-call preview --binanceChainId 56 --from ... --to ... --value <valueWei> --inputData <inputData> --json`. Follow [wallet confirmation and execution](../binance-wallet.md), then verify receipts and actual output. None of these offline commands performs those steps automatically.
