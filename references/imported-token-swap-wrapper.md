# ImportedTokenSwapWrapper External-Market Trading

## Status and ABI provenance

The BSC deployment `0xDfFc699FB095a693708E3c15e6F0a224cbbCc98F` is registered with a verified runtime hash and live getters in [BSC configuration](../config/bsc.json) and [Flap registry](../config/flap-bsc.json). The connected external adapter is Flap Pancake V2/WBNB. Recheck runtime and configuration per request; other source types below still need complete route adapters. Read the [ABI](../abis/imported-token-swap-wrapper.json) and [provenance](../abis/provenance.json).

The ABI is a trading-related subset of a local TagAI-contract-V2 compiled artifact: quotes, buys, sales, configuration getters, trade events, and errors. The provenance file records the source commit and SHA-256 hashes. The deployment record separately pins the observed BSC runtime and configuration bindings. Do not mix it with the legacy TagAISwapWrapper ABI.

## Purpose

Use only for external markets of tokens not natively issued by TagAI. Flap / Fourme / GANG internal markets call their platform contracts directly. All TagAI-native versions follow the TagAI reference. External tokens without a registered Community may also trade through the wrapper. Registration affects applicable token fees and does not prove issuance.

The outer buy spends BNB and the sale returns BNB. For a TOKEN / Q pool where Q is neither wrappedNative nor native BNB, NutboxRouter must have configured bridge routes between BNB and Q. Do not assume arbitrary conversion without a bridge route.

## Source types and sourceData

| sourceType | Source | Encoding |
| --- | --- | --- |
| 0 | V2_PAIR | abi.encode(tuple(address router,address pair)) |
| 1 | V3_POOL | abi.encode(tuple(address router,address quoter,address pool)) |
| 2 | UNISWAP_V4 | Not implemented in this source; do not call |
| 3 | PANCAKE_V4_CL | abi.encode(tuple(address quoter,tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters) pool)) |

sourceData is one ABI-encoded struct, not JSON, and has no function selector. Encode the top-level wrapper call normally afterwards. Do not reorder pool fields.

V2 / V3 compatibility depends on the actual Router / Quoter ABI. The current V3 implementation uses a Pancake-style exactInputSingle tuple; substituting a Uniswap V3 Router address is insufficient. If incompatible and a direct DEX adapter exists, follow [DEX fallback](external-dex.md).

## Verify the pool before quoting

- Verify the official deployment identity according to [DEX](external-dex.md).
- A V2 pair supplies pool information in sourceData, but the router selects the actual swap pool from the path. Its factory.getPair must return that pair.
- A V3 pool supplies tokens and fee, but the router selects the actual pool from that pair and fee. The corresponding Factory.getPool must return that pool; the quoter must use the same deployment.
- For Infinity CL, validate the complete PoolKey, poolId, poolManager / vault, hooks, and parameters. This implementation uses empty hookData for both quotes and swaps and cannot serve Hooks requiring nonempty data.
- Check quoteToken, direction, fees, and bridge routes. Quote and execution must use identical sourceData.

## Quote methods

```solidity
function quoteBuy(address token, uint8 sourceType, bytes sourceData, uint256 nativeAmountIn)
    external returns (uint256 tokenAmountOut);
function quoteSell(address token, uint8 sourceType, bytes sourceData, uint256 tokenAmountIn)
    external returns (uint256 nativeAmountOut);
```

The real mutability is nonpayable, not view. Use eth_call only, without broadcasting or sending BNB value; the amount is a method argument. Batch quotes use fixed-block Multicall. Observe the temporary-state and caller constraints for [non-view quotes](multicall.md).

Selectors calculated from this ABI are `quoteBuy=0xf275d9a8`, `quoteSell=0x366b304b`, `buyToken=0xc3ad65c4`, and `sellToken=0xf9e34283`. Always encode and decode using the full ABI; selectors do not replace argument validation.

- nativeAmountIn is gross BNB input in wei.
- tokenAmountIn is the gross token amount sold, using that token's decimals.
- quoteBuy output already deducts known wrapper native-asset fees and applicable Nutbox token fees.
- quoteSell output already deducts applicable token and native-asset fees.
- The theoretical pool quote does not fully cover dynamic transfer taxes. Simulate final delivery for taxed tokens rather than presenting a theoretical value as guaranteed net output.

## Buy

```solidity
function buyToken(
    address token,
    uint8 sourceType,
    bytes sourceData,
    uint256 minimumTokenOut,
    address recipient,
    uint256 deadline,
    address sellsman
) external payable returns (uint256 tokenOut);
```

| Parameter | Meaning and source |
| --- | --- |
| token | The user-selected and verified target token |
| sourceType / sourceData | Selected, verified DEX source with exact encoding |
| minimumTokenOut | Minimum final recipient delivery in token base units; require meaningful protection |
| recipient | The final recipient from the intent; defaults to the current wallet |
| deadline | A short validity period in Unix seconds; requote after expiry |
| sellsman | Fee subject established by configuration or user intent; do not invent a referral address |
| msg.value | Gross BNB swap input in integer wei, excluding separately paid gas |

A BNB buy needs no prior native-asset approval. The source deducts native fees before swapping, deducts applicable token fees, delivers to recipient, and checks actual delivery against minimumTokenOut. V2 / V3 outputs allow balance-delta handling for taxed tokens, subject to verified compatibility limits.

## Sell

```solidity
function sellToken(
    address token,
    uint8 sourceType,
    bytes sourceData,
    uint256 amountIn,
    uint256 minimumNativeOut,
    address recipient,
    uint256 deadline,
    address sellsman
) external returns (uint256 nativeOut);
```

amountIn is the gross token amount pulled from the caller; minimumNativeOut is minimum final net BNB in wei. Other arguments have the same meanings as for buys. Approve the actual wrapper address for the token, use value=0, and refresh the quote after approval. Do not mistake the wrapper's internal temporary approval to a DEX Router for the user's spender.

V2 supports transfer-tax inputs / outputs within verified limits. V3 buys can check actual taxed output delivery, but taxed V3 sell inputs are unsupported. Do not treat Infinity CL taxed tokens as supported. Do not promise rebase or special-transfer compatibility without evidence.

## Fees, registration, and verification

Read sellsmanRatio, tagaiRatio, nutboxTokenRatio, getImportedMarket(token), and relevant base configuration in the same snapshot. Do not hardcode source defaults as live fee rates. Basis points use denominator 10000. Do not deduct fees again when already included in the wrapper quote.

With sellsman set to the zero address, the source falls back to the registered deployer, then the platform feeAddress. Whether the subject has an IPShare affects distribution. Verify the actual deployment and rules during integration and disclose fee attribution.

Use ImportedTokenTrade to verify token, direction, sourceType, sourceHash=keccak256(sourceData), recipient, grossNativeAmount, tokenAmount, and fees. Account for taxed tokens using actual recipient delivery. Exclude gas and unrelated transfers from BNB balance-delta accounting.

Common errors include SlippageExceeded, DeadlineExpired, UnsupportedSwapSource, UnsupportedInputToken, InvalidSwapOutput, and InvalidCallback. Decode original errors with the ABI. Only confirmed incompatibility permits direct DEX fallback; handle other failures according to their actual cause.
