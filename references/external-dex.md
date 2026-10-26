# External-Market DEX Data and Routing

The DEX registry is currently empty. Live pool queries, quotes, and trading are unavailable. Only explicitly integrated Uniswap / PancakeSwap protocol variants and BSC deployments are eligible. Other brands are unsupported; V2 interface compatibility does not approve a third-party DEX.

## Pool discovery and verification

Discover routes for the user's specified token only. Do not discover or recommend tokens.

APIs / indexers may supply candidate pools. Router, Factory, Quoter, Manager, wrappedNative, and Hook capabilities must come from verified configuration. Arbitrary API responses cannot determine approval targets.

- V2: read token0/token1, factory, and reserves. Verify that the official Factory.getPair returns the candidate pair and check Router.factory / wrapped native.
- V3: verify token0/token1, fee, factory, Factory.getPool, liquidity, and current price. Router and Quoter must use the same compatible deployment. Routers with different exactInputSingle tuples cannot share an assumed ABI.
- V4 / Infinity: verify the full PoolKey, poolId, Manager / Vault, hooks, fee, parameters or tickSpacing. Uniswap V4 and Pancake Infinity CL have different structures. Infinity Bin is not automatically supported because it belongs to Pancake.
- State the candidate-pool coverage. Do not select solely by largest liquidity or claim a global optimum from an incomplete candidate set.

Read related on-chain contract state through fixed-block Multicall. Compare amount-specific net output including pool, wrapper, and Hook fees, taxes, bridges, and gas. For buys compare total BNB cost against net token output; for sales compare BNB proceeds after gas.

## Execution entry point

TagAI-native tokens: read [TagAI](platforms/tagai.md), then choose the DEX method using the actual version and listing snapshot. Do not use ImportedTokenSwapWrapper.

Other external tokens: read [Wrapper](imported-token-swap-wrapper.md) and prefer that entry point. Construct sourceType/sourceData from verified data and confirm the quoteToken bridge route.

A wrapper incompatibility must have a specific, verified reason, such as an unsupported sourceType, Router ABI, taxed-token direction, or nonempty hookData requirement. Direct DEX fallback is limited to deployments and methods already integrated into this skill. Requote, check the real spender, simulate, and preview again.

RPC timeouts, missing allowances, stale quotes, slippage failures, and wallet risk blocks do not prove incompatibility. Do not use fallback to evade a block, silently increase slippage or budget, or violate the user's route constraints.

## Prices and simulation

A reference price is not an amount-specific executable quote. Concentrated liquidity requires complete cross-tick quoting or a compatible Quoter; Hook pools must include Hook behavior. The adapter defines its exact tick / bitmap data requirements. Exclude routes with missing data.

Simulate with the real wallet from, value, allowance state, and calldata. The final minimumOut constrains the user's net delivery, not only a pool return value. Do not send failed simulations or replace protection with minimumOut=0.
