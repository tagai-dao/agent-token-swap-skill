# ImportedTokenSwapWrapper 外盘交易

## 当前状态与 ABI 来源

部署尚未核验，config/bsc.json 中 address=null、status=pending_verification。没有可执行链上能力。使用 [ABI](../abis/imported-token-swap-wrapper.json) 和 [来源记录](../abis/provenance.json) 学习接口，不据此直接发送交易。

ABI 来自 TagAI-contract-V2 本地编译产物的交易相关子集，包含报价、买卖、配置 getter、交易事件和错误；源码提交及 SHA-256 记录在来源文件。它不是对当前生产部署字节码和配置的核验。不能与旧 TagAISwapWrapper ABI 混用。

## 用途

只用于非 TagAI 原生发行币的外盘。Flap / Fourme / GANG 内盘直调平台合约；TagAI 所有版本的交易按 TagAI 文档执行。未在 wrapper 登记 Community 的外部币也可交易，登记只影响相应 token 费用，不是发行归属证明。

外层买入投入 BNB，卖出收 BNB。若外部池是 TOKEN / Q，且 Q 不是 wrappedNative 或 native BNB，则依赖 NutboxRouter 已配置 BNB 与 Q 的中转路径。没有中转路径时不能假定 wrapper 能任意兑换。

## 来源类型与 sourceData

| sourceType | 来源 | 编码 |
| --- | --- | --- |
| 0 | V2_PAIR | abi.encode(tuple(address router,address pair)) |
| 1 | V3_POOL | abi.encode(tuple(address router,address quoter,address pool)) |
| 2 | UNISWAP_V4 | 此源码未实现，不能调用 |
| 3 | PANCAKE_V4_CL | abi.encode(tuple(address quoter,tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters) pool)) |

sourceData 是 ABI 编码的单个结构体，不是 JSON，也不含函数 selector；对顶层 wrapper 函数再正常做 ABI 函数编码。池字段顺序不可交换。

V2、V3 支持范围由实际 Router / Quoter ABI 决定；当前 V3 实现使用 Pancake 风格的 exactInputSingle 参数结构，不能将 Uniswap V3 Router 仅改地址后传入。wrapper 不兼容但直接 DEX 适配已实现时走 [DEX fallback](external-dex.md)。

## 先核验池，再报价

- 核验 [DEX](external-dex.md) 规定的官方部署身份。
- V2 pair 只是 sourceData 的池信息来源；实际 swap 由 router 按 path 选池。router.factory.getPair 必须等于该 pair。
- V3 pool 提供币对与 fee；实际 swap 由 router 按币对与 fee 选池。对应 Factory.getPool 必须等于该 pool，quoter 必须使用同一部署。
- Infinity CL 校验完整 PoolKey、poolId、poolManager / vault、hooks 和 parameters。当前实现报价和 swap 都传空 hookData，不能处理要求非空数据的 Hook。
- 比较 quoteToken、方向、费率和桥接路径；报价和交易必须使用相同 sourceData。

## 报价方法

```solidity
function quoteBuy(address token, uint8 sourceType, bytes sourceData, uint256 nativeAmountIn)
    external returns (uint256 tokenAmountOut);
function quoteSell(address token, uint8 sourceType, bytes sourceData, uint256 tokenAmountIn)
    external returns (uint256 nativeAmountOut);
```

真实 mutability 为 nonpayable，不是 view。仅通过 eth_call 执行，不广播、不发送 BNB value；金额通过方法参数传入。批量报价使用固定区块 Multicall，注意 [非 view 报价](multicall.md) 的临时状态和调用者语义。

本 ABI 计算的 selector 为 `quoteBuy=0xf275d9a8`、`quoteSell=0x366b304b`、`buyToken=0xc3ad65c4`、`sellToken=0xf9e34283`。应始终用完整 ABI 编码并反解，selector 不能替代参数校验。

- nativeAmountIn 是毛 BNB 投入，单位 wei。
- tokenAmountIn 是本次卖出的毛 token 数量，按该 token decimals。
- quoteBuy 输出已经扣除已知 wrapper 原生币费用和适用的 Nutbox token 费用。
- quoteSell 输出已经扣除适用 token 费用及原生币费用。
- 动态转账税不由理论池报价完整覆盖。税币须完整模拟最终到账，不把理论值当成确定税后输出。

## 买入

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

| 参数 | 含义与来源 |
| --- | --- |
| token | 用户已选定并核验的 token |
| sourceType / sourceData | 当前路线选中、已核验的 DEX 来源及精确编码 |
| minimumTokenOut | recipient 最终最低到账，token 最小单位，必须有有效保护 |
| recipient | 意图中的最终接收者，默认当前钱包 |
| deadline | 短有效期的 Unix 秒；过期重新报价 |
| sellsman | 经既定配置或用户意图确认的费用主体；不凭空添加推荐地址 |
| msg.value | 毛 BNB swap 投入，整数 wei，不包含另付 gas |

买入不需要用户提前授权 BNB。源码扣除原生币费用后 swap，再扣适用 token fee，交付 recipient 并按实际交付检查 minimumTokenOut。V2 / V3 输出允许按税币余额差处理，仍需验证支持边界。

## 卖出

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

amountIn 是从调用者拉取的毛 token 数量，minimumNativeOut 是最终净 BNB 的最低 wei 数量。其他参数与买入同义。用户授权 token 给实际 wrapper 地址，value=0；授权后刷新报价。不能将 wrapper 内部临时授权的 DEX Router 误作用户 spender。

V2 支持有条件的转账税输入 / 输出；V3 税币输出买入可按实际交付检查，但有税输入卖出不支持；Infinity CL 税币不视为支持。rebase、特殊转账限制等没有证据则不承诺兼容。

## 费用、登记与验证

在同一快照读取 sellsmanRatio、tagaiRatio、nutboxTokenRatio、getImportedMarket(token) 及相关基础配置；不可将源码默认值写死成线上费率。basis points 分母 10000。wrapper quote 已扣费用时不重复扣。

sellsman=零地址时，源码优先回退登记 deployer，再回退平台 feeAddress；主体是否已有 IPShare 会影响分配方式。执行接入时核验实际部署与规则，展示费用归属。

用 ImportedTokenTrade 事件核验 token、方向、sourceType、sourceHash=keccak256(sourceData)、recipient、grossNativeAmount、tokenAmount 与费用。结合收款人实际到账处理税币；BNB 钱包余额差需剔除 gas 及无关转账。

常见错误包括 SlippageExceeded、DeadlineExpired、UnsupportedSwapSource、UnsupportedInputToken、InvalidSwapOutput、InvalidCallback；用 ABI 解码原始错误。只有确认兼容性不支持才转直接 DEX，其他故障按其实际原因处理。
