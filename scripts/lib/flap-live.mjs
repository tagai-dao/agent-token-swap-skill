import { readFile } from 'node:fs/promises';
import { AbiCoder, ZeroAddress, ZeroHash, formatUnits, getAddress, isAddress, keccak256, parseUnits } from 'ethers';
import { abiInterface, minimumOutput, tagaiRegistry } from './tagai.mjs';
import { ChainReader, TradeError, requireTrade } from './live-rpc.mjs';
import { FlapAgentCurve } from './flap-agent-curve.mjs';
import { normalizeTokenInput } from './token-input.mjs';

const R = JSON.parse(await readFile(new URL('../../config/flap-bsc.json', import.meta.url), 'utf8'));
const DEX = tagaiRegistry().dex;
const WBNB = tagaiRegistry().wrappedNative;
const P = 'abis/flap/portal.json', E = 'abis/erc20.json', D = 'abis/tagai/pancake.json';
const W = 'abis/imported-token-swap-wrapper.json', T = 'abis/flap/tax-token.json';
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const spec = (label, target, abi, method, args = [], required = true) => ({ label, target, abi, method, args, required });
const val = (rows, key) => rows[key]?.value;
const amount = (text, decimals) => {
  requireTrade(typeof text === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text), 'INVALID_AMOUNT', 'Specify a positive amount.');
  let result;
  try { result = parseUnits(text, decimals); } catch { throw new TradeError('INVALID_AMOUNT', 'The amount has more decimal places than the asset supports.'); }
  requireTrade(result > 0n && result < 2n ** 256n, 'INVALID_AMOUNT', 'The amount is outside the supported range.');
  return result;
};
const transaction = (abi, method, args, to, wallet, valueWei = 0n) => ({
  binanceChainId: '56', from: getAddress(wallet), to: getAddress(to), valueWei: valueWei.toString(), inputData: abi.encodeFunctionData(method, args),
});

export const flapRegistry = () => structuredClone(R);
export const flapProof = token => spec('flap:issuer', R.portal.address, P, 'getTokenV8Safe', [token], false);

export async function decodeFlapProof(row, token) {
  if (row?.ok) return row.value.status === 0n || row.value.status === 5n ? 'NO_MATCH' : 'MATCH';
  try {
    const error = (await abiInterface(P)).parseError(row?.errorData);
    if (error?.name === 'TokenNotFound' && same(error.args.token, token)) return 'NO_MATCH';
  } catch { /* Reverts without a documented negative remain UNKNOWN. */ }
  return 'UNKNOWN';
}

export class FlapLive {
  constructor({ reader = new ChainReader(), fetcher = fetch, now = () => Math.floor(Date.now() / 1000), deployment = R } = {}) {
    this.reader = reader; this.fetcher = fetcher; this.now = now; this.registry = deployment;
    this.agentCurve = new FlapAgentCurve({ reader, now, deployment: deployment.agentCurve });
  }

  async search(ticker) {
    requireTrade(typeof ticker === 'string' && ticker.trim().length > 0 && ticker.length <= 100, 'INVALID_TOKEN', 'Provide a token ticker or address.');
    let response, rows;
    try {
      response = await this.fetcher(`${this.registry.search.url}?q=${encodeURIComponent(ticker.trim())}`, { signal: AbortSignal.timeout(15000) });
      if (response.ok) rows = await response.json();
    } catch { /* An unavailable index is never a negative issuance proof. */ }
    const unique = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const coin = row?.coin ?? row;
      if (!isAddress(coin?.address)) continue;
      const contractAddress = getAddress(coin.address);
      if (!unique.has(contractAddress)) unique.set(contractAddress, { name: String(coin.name ?? ''), symbol: String(coin.symbol ?? ''), contractAddress, platform: 'Flap' });
    }
    let agentRows = null;
    try { agentRows = await this.agentCurve.search(ticker.trim()); } catch { /* Preserve an independently available ordinary Flap search. */ }
    for (const row of agentRows ?? []) if (!unique.has(row.contractAddress)) unique.set(row.contractAddress, row);
    requireTrade((response?.ok && Array.isArray(rows)) || unique.size > 0, 'SEARCH_UNAVAILABLE', 'Flap token search is unavailable. Retry the search or use the token contract address.');
    return [...unique.values()];
  }

  async resolve(input) {
    input = normalizeTokenInput(input);
    if (/^0x/i.test(input)) requireTrade(isAddress(input), 'INVALID_TOKEN_ADDRESS', 'The contract address or its checksum is invalid.');
    if (isAddress(input)) return getAddress(input);
    const rows = await this.search(input);
    const exact = rows.filter(row => row.symbol.toLowerCase() === input.toLowerCase());
    if (exact.length === 1) return exact[0].contractAddress;
    requireTrade(rows.length, 'TOKEN_NOT_FOUND', 'No matching token was found. Check the ticker or provide its address.');
    throw new TradeError('TOKEN_AMBIGUOUS', 'Several tokens match this name. Select the contract address to continue.', { candidates: (exact.length ? exact : rows).slice(0, 3) });
  }

  async verifyPortal(snapshot) {
    const code = await this.reader.rpc('eth_getCode', [this.registry.portal.address, snapshot.blockTag]);
    requireTrade(keccak256(code) === this.registry.portal.runtimeHash, 'PLATFORM_CHANGED', 'The Flap trading contract changed and needs updated verification.');
    const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    const implementation = await this.reader.rpc('eth_getStorageAt', [this.registry.portal.address, slot, snapshot.blockTag]);
    requireTrade(same(`0x${implementation.slice(-40)}`, this.registry.portal.implementation), 'PLATFORM_CHANGED', 'Flap upgraded its trading contract. Update the integration before trading.');
    const implCode = await this.reader.rpc('eth_getCode', [this.registry.portal.implementation, snapshot.blockTag]);
    requireTrade(keccak256(implCode) === this.registry.portal.implementationRuntimeHash, 'PLATFORM_CHANGED', 'The Flap trading implementation could not be verified.');
  }

  async inspect(input, { wallet = null, snapshot = null } = {}) {
    const token = await this.resolve(input);
    if (wallet) wallet = getAddress(wallet);
    snapshot ??= await this.reader.snapshot();
    const agentMarket = await this.agentCurve.identify(token, snapshot);
    if (agentMarket) return this.agentCurve.inspect(agentMarket, snapshot, wallet);
    await this.verifyPortal(snapshot);
    const calls = [spec('state', this.registry.portal.address, P, 'getTokenV8Safe', [token]),
      spec('state9', this.registry.portal.address, P, 'getTokenV9Safe', [token], false),
      spec('name', token, E, 'name', [], false), spec('symbol', token, E, 'symbol', [], false), spec('decimals', token, E, 'decimals'),
      spec('fees', this.registry.portal.address, P, 'getFeeRate'), spec('taxEnabled', this.registry.portal.address, P, 'enableTaxOnBondingCurve')];
    if (wallet) calls.push(spec('balance', token, E, 'balanceOf', [wallet]));
    const rows = await this.reader.batch(snapshot, calls, { from: wallet });
    const state = val(rows, 'state9') ?? val(rows, 'state');
    requireTrade(state.status !== 0n && state.status !== 5n, 'ISSUER_UNVERIFIED', 'This address is not an issued Flap token.');
    const decimals = Number(val(rows, 'decimals'));
    requireTrade(Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, 'TOKEN_UNITS_UNVERIFIED', 'Token units could not be verified.');
    const phase = state.status === 4n ? 'external' : state.status === 1n && state.circulatingSupply < state.dexSupplyThresh ? 'internal' : 'unavailable';
    const info = { token, wallet, snapshot, state, rows, decimals, phase, symbol: val(rows, 'symbol') ?? null,
      release: { tokenAbi: P }, platform: 'flap' };
    const quoteToken = state.quoteTokenAddress;
    const quoteMeta = same(quoteToken, ZeroAddress) ? null : await this.reader.batch(snapshot, [spec('symbol', quoteToken, E, 'symbol', [], false), spec('decimals', quoteToken, E, 'decimals')]);
    info.quoteAsset = { address: quoteToken, symbol: quoteMeta ? val(quoteMeta, 'symbol') ?? quoteToken : 'BNB', decimals: quoteMeta ? Number(val(quoteMeta, 'decimals')) : 18 };
    requireTrade(Number.isInteger(info.quoteAsset.decimals) && info.quoteAsset.decimals >= 0 && info.quoteAsset.decimals <= 36, 'TOKEN_UNITS_UNVERIFIED', 'The settlement asset units could not be verified.');
    let price = phase === 'internal' ? state.price : null;
    if (phase === 'external') {
      await this.loadV2Pool(info);
      if (info.pool) price = info.pool.quoteReserve * 10n ** BigInt(decimals) * 10n ** 18n / (info.pool.tokenReserve * 10n ** BigInt(info.quoteAsset.decimals));
    }
    info.summary = { name: val(rows, 'name') ?? info.symbol, symbol: info.symbol, contractAddress: token, platform: 'Flap', network: 'BNB Smart Chain', market: phase,
      referencePrice: price === null ? null : { amount: formatUnits(price, 18), currency: info.quoteAsset.symbol, perToken: '1', includesTradingFees: false },
      internalProgressPercent: phase === 'internal' ? formatUnits(state.progress * 10000n / 10n ** 18n, 2) : null,
      observedAt: new Date(snapshot.timestamp * 1000).toISOString() };
    await this.reader.verifySnapshot(snapshot);
    return info;
  }

  async loadV2Pool(info) {
    const pool = info.state.pool;
    if (same(pool, ZeroAddress)) return;
    const rows = await this.reader.batch(info.snapshot, [spec('factory', pool, D, 'factory', [], false), spec('token0', pool, D, 'token0', [], false),
      spec('token1', pool, D, 'token1', [], false), spec('reserves', pool, D, 'getReserves', [], false)]);
    if (!rows.reserves.ok || !same(val(rows, 'factory'), DEX.v2Factory)) return;
    const quote = same(info.quoteAsset.address, ZeroAddress) ? WBNB : info.quoteAsset.address;
    const token0 = val(rows, 'token0'), token1 = val(rows, 'token1');
    requireTrade((same(token0, info.token) && same(token1, quote)) || (same(token1, info.token) && same(token0, quote)), 'POOL_UNVERIFIED', 'The Flap listing pool does not match this token and its settlement asset.');
    const verified = await this.reader.batch(info.snapshot, [spec('pair', DEX.v2Factory, D, 'getPair', [info.token, quote]), spec('factory', DEX.v2Router, D, 'factory'), spec('wrapped', DEX.v2Router, D, 'WETH')]);
    requireTrade(same(val(verified, 'pair'), pool) && same(val(verified, 'factory'), DEX.v2Factory) && same(val(verified, 'wrapped'), WBNB), 'POOL_UNVERIFIED', 'The PancakeSwap trading pool could not be verified.');
    const reserves = val(rows, 'reserves'), tokenFirst = same(token0, info.token);
    requireTrade(reserves[0] > 0n && reserves[1] > 0n, 'NO_LIQUIDITY', 'The trading pool has no usable liquidity.');
    info.pool = { kind: 'v2', pair: pool, quote, tokenReserve: reserves[tokenFirst ? 0 : 1], quoteReserve: reserves[tokenFirst ? 1 : 0] };
  }

  async quote({ token, side, amount: input, wallet = null, slippageBps = 100, recipient = null, subject = ZeroAddress, snapshot = null }) {
    requireTrade(['buy', 'sell'].includes(side), 'INVALID_DIRECTION', 'Choose buy or sell.');
    requireTrade(Number.isInteger(slippageBps) && slippageBps >= 0 && slippageBps < 10000, 'INVALID_SLIPPAGE', 'Slippage must be between 0 and 9999 basis points.');
    const info = await this.inspect(token, { wallet, snapshot });
    if (info.agentCurve) {
      requireTrade(same(subject, ZeroAddress), 'REFERRAL_UNSUPPORTED', 'This pre-launch method does not accept a referral parameter.');
      return this.agentCurve.quote(info, { side, amount: input, wallet, slippageBps, recipient });
    }
    requireTrade(info.phase !== 'unavailable', 'MARKET_UNAVAILABLE', 'This token is not currently open for trading. Wait for its market to reopen.');
    requireTrade(this.registry.supportedTokenVersions.includes(Number(info.state.tokenVersion)), 'TOKEN_ROUTE_UNAVAILABLE', 'This token needs an updated trading connection.');
    let amountIn;
    if (side === 'sell' && typeof input === 'string' && input.endsWith('%')) {
      requireTrade(wallet, 'WALLET_REQUIRED', 'Connect the wallet to calculate its holdings.');
      const fraction = amount(input.slice(0, -1), 2);
      requireTrade(fraction <= 10000n, 'INVALID_AMOUNT', 'The holding percentage cannot exceed 100%.');
      amountIn = val(info.rows, 'balance') * fraction / 10000n;
      requireTrade(amountIn > 0n, 'INSUFFICIENT_BALANCE', 'The selected holding amount is zero.');
    } else amountIn = amount(input, side === 'buy' ? 18 : info.decimals);
    if (wallet && side === 'sell') requireTrade(val(info.rows, 'balance') >= amountIn, 'INSUFFICIENT_BALANCE', 'The wallet does not hold enough of this token.');
    let quoteOut, fees, quota = null;
    if (info.phase === 'internal') {
      requireTrade(same(info.state.extensionID, ZeroHash), 'TOKEN_RESTRICTION', 'This token has additional trading requirements that need a verified integration.');
      requireTrade(same(info.quoteAsset.address, ZeroAddress) || info.state.nativeToQuoteSwapEnabled, 'SETTLEMENT_ROUTE_UNAVAILABLE', 'A verified BNB conversion route is required for this token.');
      if (!same(info.quoteAsset.address, ZeroAddress)) {
        const conversion = await this.reader.batch(info.snapshot, [spec('config', this.registry.portal.address, P, 'getQuoteTokenConfiguration', [info.quoteAsset.address])]);
        const configured = val(conversion, 'config');
        requireTrade(configured.enabled === 1n && configured.dexId === 0n && configured.nativeToQuoteSwapType > 0n,
          'SETTLEMENT_ROUTE_UNAVAILABLE', 'The token’s BNB conversion does not use a verified supported venue.');
      }
      if (side === 'buy') {
        const cap = await this.reader.batch(info.snapshot, [spec('cap', this.registry.portal.address, P, 'maxBuyPerOrigin', [info.token])], { from: wallet });
        if (val(cap, 'cap')[1] > 0n) {
          requireTrade(wallet, 'WALLET_REQUIRED', 'Connect the wallet to calculate this token’s available buying amount.');
          const usage = await this.reader.batch(info.snapshot, [spec('quota', this.registry.portal.address, P, 'buyQuotaOf', [info.token, wallet])], { from: wallet });
          const remaining = val(usage, 'quota')[1];
          requireTrade(remaining > 0n, 'BUY_LIMIT_REACHED', 'This wallet has reached the token’s cumulative buying limit. Selling does not restore that limit.');
          quota = { remainingTokenAmount: formatUnits(remaining, info.decimals), unusedInputRefunded: true };
        }
      }
      // The outer Multicall caller preserves tx.origin for quota-aware quotes.
      const quoted = await this.reader.batch(info.snapshot, [spec('out', this.registry.portal.address, P, 'quoteExactInput', [{ inputToken: side === 'buy' ? ZeroAddress : info.token, outputToken: side === 'buy' ? info.token : ZeroAddress, inputAmount: amountIn }])], { from: wallet });
      quoteOut = val(quoted, 'out');
      const protocol = info.state.bondingCurveFeeRate;
      const tax = val(info.rows, 'taxEnabled') ? info.state[side === 'buy' ? 'buyTaxRate' : 'sellTaxRate'] : 0n;
      fees = { includedInQuote: true, protocolFeeBps: protocol === undefined ? null : Number(protocol), tokenTaxBps: Number(tax), amount: null,
        note: 'The contract quote includes its applicable fees and conversion costs; do not deduct them again.' };
    } else ({ quoteOut, fees } = await this.externalQuote(info, side, amountIn));
    requireTrade(quoteOut > 0n, 'QUOTE_UNAVAILABLE', 'No executable output is available for this amount.');
    const minimum = minimumOutput(quoteOut.toString(), slippageBps);
    requireTrade(this.now() < info.snapshot.timestamp + 60, 'QUOTE_EXPIRED', 'The quote expired during the query. Refresh it before trading.');
    await this.reader.verifySnapshot(info.snapshot);
    const summary = { ...info.summary, side, input: { amount: formatUnits(amountIn, side === 'buy' ? 18 : info.decimals), symbol: side === 'buy' ? 'BNB' : info.symbol },
      expectedOutput: { amount: formatUnits(quoteOut, side === 'buy' ? info.decimals : 18), symbol: side === 'buy' ? info.symbol : 'BNB' },
      minimumOutput: { amount: formatUnits(minimum, side === 'buy' ? info.decimals : 18), symbol: side === 'buy' ? info.symbol : 'BNB' },
      slippagePercent: formatUnits(BigInt(slippageBps), 2), fees, gasIncluded: false, buyingLimit: quota,
      expiresAt: new Date((info.snapshot.timestamp + 60) * 1000).toISOString() };
    return { info, side, amountIn, quoteOut, minimum, slippageBps, recipient: recipient ? getAddress(recipient) : wallet, subject: getAddress(subject), summary };
  }

  async externalQuote(info, side, amountIn) {
    requireTrade(info.pool && same(info.pool.quote, WBNB), 'EXTERNAL_ROUTE_UNAVAILABLE', 'This pool needs an additional verified BNB trading route. No transaction was prepared.');
    requireTrade(info.state.dexId === 0n, 'DEX_UNSUPPORTED', 'This trading venue is not supported.');
    const tokenVersion = Number(info.state.tokenVersion);
    requireTrade([...this.registry.externalCoverage.taxTokenVersions, ...this.registry.externalCoverage.nonTaxTokenVersions].includes(tokenVersion), 'TOKEN_ROUTE_UNAVAILABLE', 'This token’s transfer rules need an additional verified trading route.');
    const code = await this.reader.rpc('eth_getCode', [this.registry.wrapper.address, info.snapshot.blockTag]);
    requireTrade(keccak256(code) === this.registry.wrapper.runtimeHash, 'ROUTE_CHANGED', 'The external trading contract changed and needs updated verification.');
    const read = await this.reader.batch(info.snapshot, [spec('paused', this.registry.wrapper.address, W, 'paused'), spec('wrapped', this.registry.wrapper.address, W, 'wrappedNative'),
      spec('router', this.registry.wrapper.address, W, 'nutboxRouter'), spec('nativeFees', this.registry.wrapper.address, W, 'previewFees', [amountIn]),
      spec('tokenFees', this.registry.wrapper.address, W, 'previewTokenFee', [info.token, amountIn])]);
    requireTrade(!val(read, 'paused') && same(val(read, 'wrapped'), WBNB) && same(val(read, 'router'), this.registry.nutboxRouter.address), 'ROUTE_UNAVAILABLE', 'The external trading route is unavailable.');
    let buyTax = 0n, sellTax = 0n;
    if (tokenVersion === 6) {
      const tax = await this.reader.batch(info.snapshot, [spec('state', info.token, T, 'state'), spec('pool', info.token, T, 'mainPool'), spec('buy', info.token, T, 'buyTaxRate'), spec('sell', info.token, T, 'sellTaxRate')]);
      requireTrade(same(val(tax, 'pool'), info.pool.pair) && [2n, 3n, 4n].includes(val(tax, 'state')), 'TOKEN_RESTRICTION', 'The token’s external trading state could not be verified.');
      if (val(tax, 'state') !== 4n) { buyTax = val(tax, 'buy'); sellTax = val(tax, 'sell'); }
      requireTrade(buyTax < 10000n && sellTax < 10000n, 'QUOTE_UNAVAILABLE', 'The token tax leaves no usable trading amount.');
    }
    const path = side === 'buy' ? [WBNB, info.token] : [info.token, WBNB];
    // Flap V3 taxes pool transfers. Ordinary wallet/wrapper transfers are not
    // another pool leg. Full execution simulation still validates delivery.
    const swapInput = side === 'buy' ? val(read, 'nativeFees')[0] : val(read, 'tokenFees')[0];
    const poolInput = side === 'sell' ? swapInput - swapInput * sellTax / 10000n : swapInput;
    const poolQuote = await this.reader.batch(info.snapshot, [spec('amounts', DEX.v2Router, D, 'getAmountsOut', [poolInput, path])]);
    const amounts = val(poolQuote, 'amounts');
    requireTrade(amounts.length === 2 && amounts[0] === poolInput, 'QUOTE_UNAVAILABLE', 'The DEX quote does not match the requested input.');
    const poolOut = side === 'buy' ? amounts[1] - amounts[1] * buyTax / 10000n : amounts[1];
    const final = await this.reader.batch(info.snapshot, [side === 'buy' ? spec('out', this.registry.wrapper.address, W, 'previewTokenFee', [info.token, poolOut]) : spec('out', this.registry.wrapper.address, W, 'previewFees', [poolOut])]);
    info.sourceData = AbiCoder.defaultAbiCoder().encode(['tuple(address router,address pair)'], [[DEX.v2Router, info.pool.pair]]);
    return { quoteOut: val(final, 'out')[0], fees: { includedInQuote: true, tokenTaxBps: Number(side === 'buy' ? buyTax : sellTax),
      note: 'Includes the verified pool fee, current pool-transfer tax and wrapper fees. Dynamic tax liquidation may change execution; the final minimum is enforced on delivery.' } };
  }

  async transaction(quote, wallet) {
    if (quote.info.agentCurve) return this.agentCurve.transaction(quote, wallet);
    requireTrade(!quote.recipient || same(quote.recipient, wallet), 'RECIPIENT_UNSUPPORTED', 'This route delivers to the connected wallet.');
    if (quote.info.phase === 'internal') {
      requireTrade(same(quote.subject, ZeroAddress), 'REFERRAL_UNSUPPORTED', 'This Flap trading method does not accept a referral parameter.');
      const params = { inputToken: quote.side === 'buy' ? ZeroAddress : quote.info.token, outputToken: quote.side === 'buy' ? quote.info.token : ZeroAddress,
        inputAmount: quote.amountIn, minOutputAmount: quote.minimum, permitData: '0x' };
      return transaction(await abiInterface(P), 'swapExactInput', [params], this.registry.portal.address, wallet, quote.side === 'buy' ? quote.amountIn : 0n);
    }
    const args = [quote.info.token, 0, quote.info.sourceData];
    if (quote.side === 'sell') args.push(quote.amountIn);
    args.push(quote.minimum, wallet, this.now() + 180, quote.subject);
    return transaction(await abiInterface(W), quote.side === 'buy' ? 'buyToken' : 'sellToken', args, this.registry.wrapper.address, wallet, quote.side === 'buy' ? quote.amountIn : 0n);
  }

  async nextApproval(quote, wallet) {
    if (quote.info.agentCurve) return null;
    if (quote.side !== 'sell') return null;
    const spender = quote.info.phase === 'internal' ? this.registry.portal.address : this.registry.wrapper.address;
    const rows = await this.reader.batch(quote.info.snapshot, [spec('allowance', quote.info.token, E, 'allowance', [wallet, spender])]);
    const allowance = val(rows, 'allowance');
    if (allowance >= quote.amountIn) return null;
    // Reset a nonzero insufficient allowance first; never silently grant infinity.
    const approvalAmount = allowance > 0n ? 0n : quote.amountIn;
    return { transaction: transaction(await abiInterface(E), 'approve', [spender, approvalAmount], quote.info.token, wallet),
      scope: { token: quote.info.symbol, spender, amount: formatUnits(approvalAmount, quote.info.decimals), purpose: approvalAmount === 0n ? 'Reset the existing allowance before approving this sale.' : 'Allow the selected sale amount.' } };
  }
}
