# TagAI External-Market Calls

V5 and V8 are excluded from both DEX paths. This reference applies only after native TagAI issuance and listed=true are verified. Neither ImportedTokenSwapWrapper nor the legacy TagAI swap wrappers are used. Token import registration is not native issuance.

## V1-V4: direct Pancake V2

Use the official Factory / Router / WBNB entries in [the registry](../../config/tagai-bsc.json), not an API-supplied router. The [DEX ABI](../../abis/tagai/pancake.json) includes:

```solidity
function getPair(address tokenA,address tokenB) external view returns(address pair);
function getAmountsOut(uint256 amountIn,address[] path) external view returns(uint256[] amounts);
function swapExactETHForTokensSupportingFeeOnTransferTokens(
    uint256 amountOutMin,address[] path,address to,uint256 deadline
) external payable;
function swapExactTokensForETHSupportingFeeOnTransferTokens(
    uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline
) external;
```

Multicall stage A: Router.factory(), Router.WETH(), Factory.getPair(token,WBNB), token.listed(), balance / approval as needed. Stage B at the same block: pair.token0(), pair.token1(), pair.factory(), pair.getReserves(), and Router.getAmountsOut for the exact input / path. Verify the quoted and executed pair are identical. Add pair.factory() from its verified standard interface if absent from a historical ABI.

Buy path is `[WBNB,token]`, `to` is the recipient, `msg.value` is gross BNB input. Sell path is `[token,WBNB]`, `amountIn` is exact token units, `msg.value=0`, and the ERC20 spender is Router02. Use finite approvals and refresh the quote after approval.

Use the direct Router path below with the quoted amount and verified pair. Router.getAmountsOut is theoretical before dynamic token taxes. Simulate the full SupportingFeeOnTransfer call and verify final recipient output. If a token requires an old wrapper or rejects direct DEX calls, report incompatibility and stop rather than violate this skill's route rule.

## V7 / V9 / V11 / V13-V16: direct Infinity CL

This release handles the native main pool only: currency0=zero address (native BNB), currency1=the proven token, with the trusted CLPoolManager / Vault. Stable-token, wrapped-native, component, and multi-hop pools are not interchangeable with this route.

### Recover and verify PoolKey

Read token.v4PoolId(). For V13+ also read listingHook(), listingPoolParameters(), listingInfrastructure(), clPoolManager(), and vault() using that Token ABI. Read CLPoolManager.poolIdToPoolKey(poolId), getSlot0(poolId), and getLiquidity(poolId) in a dependent Multicall stage at the same block. API JSON PoolKeys or pool IDs are hints only.

```solidity
struct PoolKey {
    address currency0;
    address currency1;
    address hooks;
    address poolManager;
    uint24 fee;
    bytes32 parameters;
}
```

Require `poolId == keccak256(abi.encode(PoolKey))`, correct native/token order, trusted manager / vault, initialized price, available liquidity, and the token's bound Hook / parameters where exposed. A current Pump Hook configuration cannot overwrite an older token's listing snapshot. The offline helper additionally rejects a Hook that differs from a recorded per-deployment Hook until evidence is updated; do not edit the address merely to force encoding.

### Quote

```solidity
function quoteExactInputSingle(
    (PoolKey poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params
) external returns(uint256 amountOut,uint256 gasEstimate);
```

This ABI notation describes the nested tuple; use the exact JSON ABI to encode it. It is nonpayable, not view. Use eth_call through fixed-block Multicall for batch quotes, never broadcast. Buy uses zeroForOne=true and BNB wei exactAmount; sell uses false and token units. Include the exact same hookData used for execution. Do not convert a failed quote to zero or apply a spot-price estimate as fallback.

For subject=zero, hookData is `0x`; otherwise it is `abi.encode(address subject)`, not encodePacked(address) or a subject string. The Hook can fall back to the creator when no valid subject IPShare exists. For the pinned modern Hook, BNB-side fees apply in beforeSwap / afterSwap according to direction; a compatible Quoter already reflects those deltas. Do not subtract another flat Hook percentage from its output.

The current modern source records 30/30/30 bps BNB-side splits, but older Hooks differ. Use the exact bound implementation; do not extrapolate that rate to all versions. Quoting and settlement can trigger Hook / Nutbox behavior, so validate a full real-wallet execution simulation rather than treating any generic CL Quoter as sufficient.

### Universal Router payload

Call the trusted Universal Router, not the bare pool manager or vault:

```solidity
function execute(bytes commands,bytes[] inputs,uint256 deadline) external payable;
```

`commands=0x10` is the INFI_SWAP command without an allow-revert flag. Its sole input is `abi.encode(bytes actions,bytes[] params)`, with `actions=0x060c0f`:

| Action | Exact params encoding |
| --- | --- |
| 0x06 CL_SWAP_EXACT_IN_SINGLE | `abi.encode((PoolKey poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData))` |
| 0x0c SETTLE_ALL | `abi.encode(address currencyIn,uint128 maxAmount)` |
| 0x0f TAKE_ALL | `abi.encode(address currencyOut,uint128 minAmount)` |

Buy: currencyIn=zero, currencyOut=token, zeroForOne=true, value=amountIn BNB wei. Sell: currencyIn=token, currencyOut=zero, zeroForOne=false, value=0. Put the same protected minimum in the swap and TAKE_ALL parameters. This action sequence delivers to the router caller, so the helper rejects custom recipients. Do not assume TAKE_ALL accepts a recipient argument.

The [offline encoder](tools.md) implements the exact nested tuple and returns the poolId, hookData, command bytes, action bytes, final calldata, and independent ABI decoding. Amount input must fit the supported int128 range and tuple fields their actual widths. Do not copy Uniswap V4 action layouts or fee / tickSpacing PoolKeys into Pancake Infinity.

### Sell authorization chain

Two distinct approvals may be necessary:

1. On the token contract: `approve(Permit2, requiredTokenAmount)` using the ERC20 ABI. Read allowance(wallet,Permit2) first.
2. On Permit2: `approve(token,UniversalRouter,uint160 amount,uint48 expiration)`. Read `allowance(wallet,token,UniversalRouter)` and require both sufficient amount and unexpired expiration.

The Permit2 spender is UniversalRouter; the ERC20 spender is Permit2. Use finite amounts and bounded expiration covering the execution deadline. Do not copy the frontend's maximum uint256 / uint160 / uint48 approvals. No off-chain EIP-712 signature is necessary for this allowance-based flow. Each approval uses wallet preview / confirmation and waits for its receipt before refreshing state and quoting the swap.

### V13+ component-route boundary

V13-V16 may have a native main pool and component V2 pools. A component route requires native-to-component pricing, per-transfer burn / fees, route configuration hashes, shared-pool execution effects, and final net-output verification. The source includes specialized trade executors, but this release does not silently substitute them or advertise a global best-price optimizer. Use the verified native main pool when compatible; explain unavailable component routing when it matters to a user's explicit request.

## Final checks

Confirm all selected deployments, user constraints, state, quote amount, Hook data, spender, and final minimum. Simulate with the real wallet from, exact value / calldata, and actual approvals. Show the Binance preview and require confirmation under the wallet policy. Track the receipt and actual recipient token / BNB changes, not only Quoter numbers. A revert or wallet risk block must not switch to a wrapper or another route automatically.
