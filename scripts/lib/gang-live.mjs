import { readFile } from 'node:fs/promises';
import { AbiCoder, ZeroAddress, formatUnits, getAddress, isAddress, keccak256, parseUnits } from 'ethers';
import { abiInterface, minimumOutput, tagaiRegistry } from './tagai.mjs';
import { ChainReader, TradeError, requireTrade } from './live-rpc.mjs';
import { normalizeTokenInput } from './token-input.mjs';
import { gangBuy, gangSell, GANG_VIRTUAL_TOKEN, splitSlippage } from './gang-math.mjs';
import { flapRegistry } from './flap-live.mjs';

const R = JSON.parse(await readFile(new URL('../../config/gang-bsc.json', import.meta.url), 'utf8'));
const T = tagaiRegistry(), F = flapRegistry(), E = 'abis/erc20.json', D = 'abis/tagai/pancake.json', W = 'abis/imported-token-swap-wrapper.json', G = 'abis/gang/dex.json';
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const val = (rows, label) => rows[label]?.value;
const spec = (label, target, abi, method, args = [], required = true) => ({ label, target, abi, method, args, required });
const tx = (abi, method, args, to, wallet, value = 0n) => ({ binanceChainId: '56', from: getAddress(wallet), to: getAddress(to), valueWei: value.toString(), inputData: abi.encodeFunctionData(method, args) });
const units = (amount, decimals) => { let raw; try { requireTrade(typeof amount === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount), 'INVALID_AMOUNT', 'Specify a positive amount.'); raw = parseUnits(amount, decimals); } catch { throw new TradeError('INVALID_AMOUNT', 'Specify a valid amount in the asset units.'); } requireTrade(raw > 0n && raw < 2n ** 256n, 'INVALID_AMOUNT', 'The amount must be positive.'); return raw; };
export const gangRegistry = () => structuredClone(R);
export const gangProofs = token => R.pads.map(pad => spec(`gang:${pad.id}`, pad.address, pad.abi, 'curves', [token], false));

export class GangLive {
  constructor({ reader = new ChainReader(), fetcher = fetch, now = () => Math.floor(Date.now() / 1000), deployment = R, wrapperDeployment = F } = {}) { this.reader = reader; this.fetcher = fetcher; this.now = now; this.registry = deployment; this.wrapperDeployment = wrapperDeployment; }

  async search(ticker) {
    requireTrade(typeof ticker === 'string' && ticker.trim() && ticker.length <= 100, 'INVALID_TOKEN', 'Provide a token ticker.');
    let response, rows;
    try { response = await this.fetcher(`${this.registry.searchUrl}?q=${encodeURIComponent(ticker.trim())}`, { signal: AbortSignal.timeout(15000) }); if (response.ok) rows = await response.json(); } catch { /* A failed index is not a negative issuance proof. */ }
    requireTrade(response?.ok && Array.isArray(rows), 'SEARCH_UNAVAILABLE', 'GANG ticker search is unavailable. Use the contract address or retry.');
    const result = new Map();
    for (const row of rows) if ((row.chainId === undefined || Number(row.chainId) === 56) && isAddress(row.address)) { const address = getAddress(row.address); if (!result.has(address)) result.set(address, { contractAddress: address, name: String(row.name ?? ''), symbol: String(row.symbol ?? ''), platform: 'GANG' }); }
    return [...result.values()];
  }

  async resolve(input) {
    input = normalizeTokenInput(input);
    if (/^0x/i.test(input)) { requireTrade(isAddress(input), 'INVALID_TOKEN_ADDRESS', 'The contract address or checksum is invalid.'); return getAddress(input); }
    const rows = await this.search(input), exact = rows.filter(row => row.symbol.toLowerCase() === input.toLowerCase());
    if (exact.length === 1) return exact[0].contractAddress;
    requireTrade(rows.length, 'TOKEN_NOT_FOUND', 'No matching GANG token was found.');
    throw new TradeError('TOKEN_AMBIGUOUS', 'Select the token contract address.', { candidates: (exact.length ? exact : rows).slice(0, 3) });
  }

  async inspect(input, { wallet = null, snapshot = null } = {}) {
    const token = await this.resolve(input); snapshot ??= await this.reader.snapshot(); if (wallet) wallet = getAddress(wallet);
    const proofs = await this.reader.batch(snapshot, this.registry.pads.map(pad => spec(`gang:${pad.id}`, pad.address, pad.abi, 'curves', [token])));
    const matches = this.registry.pads.filter(pad => !same(val(proofs, `gang:${pad.id}`)[0], ZeroAddress));
    requireTrade(matches.length === 1, matches.length > 1 ? 'ISSUER_AMBIGUOUS' : 'ISSUER_UNVERIFIED', 'GANG issuance could not be uniquely verified.');
    const pad = matches[0], raw = val(proofs, `gang:${pad.id}`);
    requireTrade(keccak256(await this.reader.rpc('eth_getCode', [pad.address, snapshot.blockTag])) === pad.runtimeHash, 'PLATFORM_CHANGED', 'The GANG trading deployment changed and needs verification.');
    const curve = pad.kind === 'native' ? { creator: raw[0], realQuote: raw[1], sold: raw[2], graduated: raw[3], pair: raw[4], quote: T.wrappedNative } : { creator: raw[0], quote: raw[1], realQuote: raw[2], sold: raw[3], gradAmt: raw[4], virtualQuote: raw[5], graduated: raw[6], taxed: pad.id === 's' || raw[7], pair: raw[pad.id === 's' ? 7 : 8], refPair: raw[pad.id === 's' ? 8 : 9] };
    const calls = [spec('name', token, E, 'name'), spec('symbol', token, E, 'symbol'), spec('decimals', token, E, 'decimals'), spec('boundPad', token, G, 'launchpad'), spec('locked', token, G, 'locked'), spec('cap', pad.address, pad.abi, 'MAX_PER_WALLET'), spec('room', pad.address, pad.abi, 'walletRoom', [token, wallet ?? ZeroAddress])];
    if (pad.kind === 'native') calls.push(spec('grad', pad.address, pad.abi, 'GRADUATION_BNB'), spec('spot', pad.address, pad.abi, 'spotPrice', [token], false));
    if (wallet) calls.push(spec('balance', token, E, 'balanceOf', [wallet]), spec('agent', pad.address, pad.abi, 'isAgent', [wallet]));
    const rows = await this.reader.batch(snapshot, calls);
    requireTrade(same(val(rows, 'boundPad'), pad.address), 'TOKEN_IDENTITY_UNVERIFIED', 'The token does not match its GANG launchpad.');
    const decimals = Number(val(rows, 'decimals')); requireTrade(decimals === 18, 'TOKEN_UNITS_UNVERIFIED', 'The GANG token units could not be verified.');
    const quoteAddress = same(curve.quote, ZeroAddress) ? T.wrappedNative : curve.quote;
    const metadata = same(quoteAddress, T.wrappedNative) ? null : await this.reader.batch(snapshot, [spec('symbol', quoteAddress, E, 'symbol'), spec('decimals', quoteAddress, E, 'decimals')]);
    const quoteAsset = { address: quoteAddress, symbol: metadata ? val(metadata, 'symbol') : 'BNB', decimals: metadata ? Number(val(metadata, 'decimals')) : 18 };
    requireTrade(Number.isInteger(quoteAsset.decimals) && quoteAsset.decimals >= 0 && quoteAsset.decimals <= 36, 'TOKEN_UNITS_UNVERIFIED', 'Settlement units could not be verified.');
    const info = { token, pad, curve, rows, wallet, snapshot, decimals, symbol: val(rows, 'symbol'), quoteAsset, platform: 'gang', phase: curve.graduated ? 'external' : 'internal', release: { tokenAbi: pad.abi } };
    let price;
    if (curve.graduated) { requireTrade(!val(rows, 'locked'), 'MARKET_MIGRATING', 'Token trading is moving to its external pool.'); await this.pool(info); price = info.pool.quoteReserve * 10n ** 18n / info.pool.tokenReserve; }
    else if (pad.kind === 'native') price = val(rows, 'spot');
    else { requireTrade(curve.virtualQuote > 0n && curve.sold < GANG_VIRTUAL_TOKEN, 'INCOMPLETE_STATE', 'The curve state is invalid.'); price = (curve.virtualQuote + curve.realQuote) * 10n ** 18n / (GANG_VIRTUAL_TOKEN - curve.sold); }
    const target = curve.gradAmt ?? val(rows, 'grad');
    info.summary = { name: val(rows, 'name'), symbol: info.symbol, contractAddress: token, platform: 'GANG', network: 'BNB Smart Chain', market: info.phase,
      referencePrice: price === undefined ? null : { amount: formatUnits(price, quoteAsset.decimals), currency: quoteAsset.symbol, perToken: '1', includesTradingFees: false }, internalProgressPercent: curve.graduated ? null : formatUnits(curve.realQuote * 10000n / target, 2), observedAt: new Date(snapshot.timestamp * 1000).toISOString() };
    await this.reader.verifySnapshot(snapshot); return info;
  }

  async pool(info) {
    const pair = info.curve.pair;
    requireTrade(!same(pair, ZeroAddress), 'POOL_UNVERIFIED', 'The external trading pair is not ready.');
    const rows = await this.reader.batch(info.snapshot, [spec('factory', pair, D, 'factory'), spec('token0', pair, D, 'token0'), spec('token1', pair, D, 'token1'), spec('reserves', pair, D, 'getReserves'), spec('pair', T.dex.v2Factory, D, 'getPair', [info.token, info.quoteAsset.address]), spec('routerFactory', T.dex.v2Router, D, 'factory'), spec('wrapped', T.dex.v2Router, D, 'WETH')]);
    requireTrade(same(val(rows, 'factory'), T.dex.v2Factory) && same(val(rows, 'routerFactory'), T.dex.v2Factory) && same(val(rows, 'wrapped'), T.wrappedNative) && same(val(rows, 'pair'), pair), 'POOL_UNVERIFIED', 'The external Pancake pair could not be verified.');
    const first = same(val(rows, 'token0'), info.token), other = first ? val(rows, 'token1') : val(rows, 'token0');
    requireTrade((first || same(val(rows, 'token1'), info.token)) && same(other, info.quoteAsset.address) && val(rows, 'reserves')[0] > 0n && val(rows, 'reserves')[1] > 0n, 'POOL_UNVERIFIED', 'The pair assets or liquidity do not match.');
    info.pool = { pair, tokenReserve: val(rows, 'reserves')[first ? 0 : 1], quoteReserve: val(rows, 'reserves')[first ? 1 : 0] };
  }

  async external(info, side, input, bps, wallet) {
    requireTrade(this.registry.supportedSettlementAssets.some(asset => same(asset, info.quoteAsset.address)), 'SETTLEMENT_ROUTE_UNAVAILABLE', 'This external quote asset needs a verified BNB route.');
    const at = info.snapshot, pair = info.pool.pair;
    requireTrade(keccak256(await this.reader.rpc('eth_getCode', [this.wrapperDeployment.wrapper.address, at.blockTag])) === this.wrapperDeployment.wrapper.runtimeHash, 'ROUTE_CHANGED', 'The swap wrapper identity changed.');
    requireTrade(keccak256(await this.reader.rpc('eth_getCode', [this.wrapperDeployment.nutboxRouter.address, at.blockTag])) === this.wrapperDeployment.nutboxRouter.runtimeHash, 'ROUTE_CHANGED', 'The settlement router identity changed.');
    const config = await this.reader.batch(at, [spec('paused', this.wrapperDeployment.wrapper.address, W, 'paused'), spec('wrapped', this.wrapperDeployment.wrapper.address, W, 'wrappedNative'), spec('router', this.wrapperDeployment.wrapper.address, W, 'nutboxRouter')]);
    requireTrade(!val(config, 'paused') && same(val(config, 'wrapped'), T.wrappedNative) && same(val(config, 'router'), this.wrapperDeployment.nutboxRouter.address), 'ROUTE_UNAVAILABLE', 'The external wrapper is unavailable.');
    let useWrapper = true, bridgeInfo = null;
    if (!same(info.quoteAsset.address, T.wrappedNative)) {
      bridgeInfo = await this.inspect(info.quoteAsset.address, { snapshot: at });
      requireTrade(bridgeInfo.phase === 'external' && same(bridgeInfo.quoteAsset.address, T.wrappedNative) && !bridgeInfo.curve.taxed, 'SETTLEMENT_ROUTE_UNAVAILABLE', 'The settlement token needs a verified native pool.');
      const route = await this.reader.batch(at, [spec('has', this.wrapperDeployment.nutboxRouter.address, G, 'hasRoute', [T.wrappedNative, info.quoteAsset.address]), spec('count', this.wrapperDeployment.nutboxRouter.address, G, 'routePoolCount', [T.wrappedNative, info.quoteAsset.address])]);
      useWrapper = val(route, 'has');
      if (useWrapper) {
        requireTrade(val(route, 'count') === 1n, 'SETTLEMENT_ROUTE_UNAVAILABLE', 'The configured settlement route needs additional verification.');
        const id = await this.reader.batch(at, [spec('id', this.wrapperDeployment.nutboxRouter.address, G, 'routePoolAt', [T.wrappedNative, info.quoteAsset.address, 0])]);
        const pool = val(await this.reader.batch(at, [spec('pool', this.wrapperDeployment.nutboxRouter.address, G, 'pricePool', [val(id, 'id')])]), 'pool');
        requireTrade(pool.enabled && pool.sourceType === 0n, 'SETTLEMENT_ROUTE_UNAVAILABLE', 'The settlement route is not a verified V2 route.');
        const [source] = AbiCoder.defaultAbiCoder().decode(['tuple(address router,address pair)'], pool.sourceData);
        requireTrade(same(source.router, T.dex.v2Router) && same(source.pair, bridgeInfo.pool.pair), 'POOL_UNVERIFIED', 'The configured bridge does not match the verified pair.');
      }
    }
    let tax = 0n;
    if (info.curve.taxed) {
      const calls = [spec('pair', info.token, G, 'pair'), spec('handler', info.token, G, 'taxHandler'), spec('bps', info.token, G, 'OUTER_TAX_BPS'), spec('pairExcluded', info.token, G, 'isExcluded', [pair])];
      if (useWrapper || wallet) calls.push(spec('endpointExcluded', info.token, G, 'isExcluded', [useWrapper ? this.wrapperDeployment.wrapper.address : wallet]));
      const taxes = await this.reader.batch(at, calls);
      requireTrade(same(val(taxes, 'pair'), pair) && val(taxes, 'bps') === 100n, 'TOKEN_RESTRICTION', 'The external token tax rules need verification.');
      tax = same(val(taxes, 'handler'), ZeroAddress) || val(taxes, 'pairExcluded') || val(taxes, 'endpointExcluded') ? 0n : 100n;
    }
    let swapInput = input;
    if (useWrapper) swapInput = val(await this.reader.batch(at, [side === 'buy' ? spec('fee', this.wrapperDeployment.wrapper.address, W, 'previewFees', [input]) : spec('fee', this.wrapperDeployment.wrapper.address, W, 'previewTokenFee', [info.token, input])]), 'fee')[0];
    if (side === 'sell') swapInput -= swapInput * tax / 10000n;
    if (useWrapper && bridgeInfo && side === 'buy') swapInput = val(await this.reader.batch(at, [spec('out', T.dex.v2Router, D, 'getAmountsOut', [swapInput, [T.wrappedNative, info.quoteAsset.address]])]), 'out')[1];
    const path = useWrapper ? (side === 'buy' ? [info.quoteAsset.address, info.token] : [info.token, info.quoteAsset.address]) : (side === 'buy' ? [T.wrappedNative, info.quoteAsset.address, info.token] : [info.token, info.quoteAsset.address, T.wrappedNative]);
    const amounts = val(await this.reader.batch(at, [spec('out', T.dex.v2Router, D, 'getAmountsOut', [swapInput, path])]), 'out');
    requireTrade(amounts.length === path.length && amounts[0] === swapInput, 'QUOTE_UNAVAILABLE', 'The DEX quote does not match its input.');
    let output = amounts.at(-1);
    if (side === 'buy') output -= output * tax / 10000n;
    if (useWrapper && bridgeInfo && side === 'sell') output = val(await this.reader.batch(at, [spec('out', T.dex.v2Router, D, 'getAmountsOut', [output, [info.quoteAsset.address, T.wrappedNative]])]), 'out')[1];
    if (useWrapper) output = val(await this.reader.batch(at, [side === 'buy' ? spec('fee', this.wrapperDeployment.wrapper.address, W, 'previewTokenFee', [info.token, output]) : spec('fee', this.wrapperDeployment.wrapper.address, W, 'previewFees', [output])]), 'fee')[0];
    const q = this.makeStep(info, side, input, output, bps, { kind: useWrapper ? 'wrapper' : 'direct', path, sourceData: AbiCoder.defaultAbiCoder().encode(['tuple(address router,address pair)'], [[T.dex.v2Router, pair]]), fallback: useWrapper ? null : 'The wrapper settlement router has no route for this quote asset.' });
    q.summary.fees = { includedInQuote: true, tokenTaxBps: Number(tax), dexFeesIncluded: true, wrapperFeesIncluded: useWrapper }; return q;
  }

  makeStep(info, side, input, output, bps, step) {
    requireTrade(output > 0n, 'QUOTE_UNAVAILABLE', 'This amount has no executable output.');
    return { info, side, amountIn: input, quoteOut: output, minimum: minimumOutput(output.toString(), bps), slippageBps: bps, recipient: info.wallet, step,
      summary: { ...info.summary, side, input: { amount: formatUnits(input, side === 'buy' ? 18 : info.decimals), symbol: side === 'buy' ? 'BNB' : info.symbol }, expectedOutput: { amount: formatUnits(output, side === 'buy' ? info.decimals : 18), symbol: side === 'buy' ? info.symbol : 'BNB' }, minimumOutput: { amount: formatUnits(minimumOutput(output.toString(), bps), side === 'buy' ? info.decimals : 18), symbol: side === 'buy' ? info.symbol : 'BNB' }, slippagePercent: formatUnits(BigInt(bps), 2), gasIncluded: false, expiresAt: new Date((info.snapshot.timestamp + 60) * 1000).toISOString() } };
  }

  async padQuote(info, side, input, bps) {
    requireTrade(info.phase === 'internal' && info.pad.trading, 'TOKEN_ROUTE_UNAVAILABLE', 'This internal deployment needs an updated trading adapter.');
    if (info.wallet) requireTrade(val(info.rows, 'agent'), 'BUYER_INELIGIBLE', 'GANG internal trading requires an Agent ID on this wallet.');
    let result;
    if (info.pad.kind === 'native') { const raw = val(await this.reader.batch(info.snapshot, [spec('out', info.pad.address, info.pad.abi, side === 'buy' ? 'quoteBuy' : 'quoteSell', side === 'buy' ? [info.token, info.wallet ?? ZeroAddress, input] : [info.token, input])]), 'out'); result = side === 'buy' ? { output: raw[0], fee: raw[2], refund: raw[3] } : { output: raw[0], fee: raw[1] }; }
    else result = side === 'buy' ? gangBuy(info.curve, input, val(info.rows, 'room')) : gangSell(info.curve, input);
    const q = this.makeStep(info, side, input, result.output, bps, { kind: 'pad' });
    if (info.pad.kind === 'quote') {
      q.summary.input = { amount: formatUnits(input, side === 'buy' ? info.quoteAsset.decimals : 18), symbol: side === 'buy' ? info.quoteAsset.symbol : info.symbol };
      if (side === 'sell') { q.summary.expectedOutput = { amount: formatUnits(result.output, info.quoteAsset.decimals), symbol: info.quoteAsset.symbol }; q.summary.minimumOutput = { amount: formatUnits(q.minimum, info.quoteAsset.decimals), symbol: info.quoteAsset.symbol }; }
    }
    q.summary.fees = { includedInQuote: true, currency: info.quoteAsset.symbol, amount: formatUnits(result.fee, info.quoteAsset.decimals), protocolFeeBps: 100 };
    if (result.refund) q.summary.expectedSettlementRefund = { amount: formatUnits(result.refund, info.quoteAsset.decimals), symbol: info.quoteAsset.symbol };
    return q;
  }

  async conversion(info, side, amount, bps) {
    if (same(info.quoteAsset.address, T.wrappedNative)) return this.makeStep({ ...info, token: T.wrappedNative, symbol: 'WBNB', decimals: 18, summary: { ...info.summary, name: 'Wrapped BNB', symbol: 'WBNB', contractAddress: T.wrappedNative, market: 'external' } }, side, amount, amount, 0, { kind: side === 'buy' ? 'wrap' : 'unwrap' });
    const asset = await this.inspect(info.quoteAsset.address, { wallet: info.wallet, snapshot: info.snapshot });
    requireTrade(asset.phase === 'external' && same(asset.quoteAsset.address, T.wrappedNative) && !asset.curve.taxed, 'SETTLEMENT_ROUTE_UNAVAILABLE', 'The settlement asset has no verified BNB conversion.');
    return this.external(asset, side, amount, bps, info.wallet);
  }

  async quote({ token, side, amount, wallet = null, slippageBps = 100, snapshot = null, recipient = null, subject = ZeroAddress }) {
    requireTrade(['buy', 'sell'].includes(side), 'INVALID_DIRECTION', 'Choose buy or sell.'); splitSlippage(slippageBps);
    requireTrade(same(subject, ZeroAddress) && (!recipient || wallet && same(recipient, wallet)), 'RECIPIENT_UNSUPPORTED', 'This GANG route delivers to the connected wallet.');
    const info = await this.inspect(token, { wallet, snapshot });
    let input;
    if (side === 'sell' && typeof amount === 'string' && amount.endsWith('%')) { requireTrade(wallet, 'WALLET_REQUIRED', 'Connect the wallet to calculate its holding percentage.'); const fraction = units(amount.slice(0, -1), 2); requireTrade(fraction <= 10000n, 'INVALID_AMOUNT', 'The holding percentage exceeds 100%.'); input = val(info.rows, 'balance') * fraction / 10000n; }
    else input = units(amount, side === 'buy' ? 18 : info.decimals);
    if (side === 'sell' && wallet) requireTrade(val(info.rows, 'balance') >= input, 'INSUFFICIENT_BALANCE', 'The wallet does not hold the selected token amount.');
    let q;
    if (info.phase === 'external') q = await this.external(info, side, input, slippageBps, wallet);
    else if (info.pad.kind === 'native') q = await this.padQuote(info, side, input, slippageBps);
    else {
      requireTrade(this.registry.supportedSettlementAssets.some(asset => same(asset, info.quoteAsset.address)), 'SETTLEMENT_ROUTE_UNAVAILABLE', 'This settlement asset needs an additional verified BNB conversion.');
      const [a, b] = same(info.quoteAsset.address, T.wrappedNative) ? (side === 'buy' ? [0, slippageBps] : [slippageBps, 0]) : splitSlippage(slippageBps);
      const first = side === 'buy' ? await this.conversion(info, 'buy', input, a) : await this.padQuote(info, 'sell', input, a);
      const second = side === 'buy' ? await this.padQuote(info, 'buy', first.quoteOut, b) : await this.conversion(info, 'sell', first.quoteOut, b);
      const worst = side === 'buy' ? await this.padQuote(info, 'buy', first.minimum, b) : await this.conversion(info, 'sell', first.minimum, b);
      q = this.makeStep(info, side, input, second.quoteOut, slippageBps, { kind: 'route' }); q.minimum = worst.minimum; q.summary.minimumOutput = worst.summary.minimumOutput;
      q.routeSteps = [first, second]; q.routeBps = [a, b]; q.summary.steps = [first.summary, second.summary]; q.summary.fees = { includedInQuote: true, steps: [first.summary.fees ?? null, second.summary.fees ?? null] }; q.summary.intermediateAsset = info.quoteAsset;
    }
    requireTrade(this.now() < info.snapshot.timestamp + 60, 'QUOTE_EXPIRED', 'The quote expired. Refresh it.'); await this.reader.verifySnapshot(info.snapshot); return q;
  }

  async routeStep(intent, index, amountRaw) {
    const info = await this.inspect(intent.token, { wallet: intent.wallet });
    requireTrade(info.phase === 'internal' && info.pad.kind === 'quote', 'MARKET_CHANGED', 'The internal route changed. Refresh the remaining trade.');
    const side = intent.side;
    const bps = intent.routeBps[index];
    return (index === 0) === (side === 'buy') ? this.conversion(info, side, BigInt(amountRaw), bps) : this.padQuote(info, side, BigInt(amountRaw), bps);
  }

  async transaction(q, wallet) {
    const { info, step } = q;
    if (step.kind === 'wrap' || step.kind === 'unwrap') return tx(await abiInterface('abis/gang/wbnb.json'), step.kind === 'wrap' ? 'deposit' : 'withdraw', step.kind === 'wrap' ? [] : [q.amountIn], T.wrappedNative, wallet, step.kind === 'wrap' ? q.amountIn : 0n);
    if (step.kind === 'pad') return tx(await abiInterface(info.pad.abi), q.side, info.pad.kind === 'native' && q.side === 'buy' ? [info.token, q.minimum] : [info.token, q.amountIn, q.minimum], info.pad.address, wallet, info.pad.kind === 'native' && q.side === 'buy' ? q.amountIn : 0n);
    if (step.kind === 'wrapper') return tx(await abiInterface(W), q.side === 'buy' ? 'buyToken' : 'sellToken', [info.token, 0, step.sourceData, ...(q.side === 'sell' ? [q.amountIn] : []), q.minimum, wallet, this.now() + 180, ZeroAddress], this.wrapperDeployment.wrapper.address, wallet, q.side === 'buy' ? q.amountIn : 0n);
    requireTrade(step.kind === 'direct', 'MULTI_STEP_ROUTE', 'Prepare the route steps in order.');
    return tx(await abiInterface(D), q.side === 'buy' ? 'swapExactETHForTokensSupportingFeeOnTransferTokens' : 'swapExactTokensForETHSupportingFeeOnTransferTokens', [...(q.side === 'sell' ? [q.amountIn] : []), q.minimum, step.path, wallet, this.now() + 180], T.dex.v2Router, wallet, q.side === 'buy' ? q.amountIn : 0n);
  }

  async captureActualOutput(plan, receipt) {
    const erc20 = await abiInterface(E);
    const abi = await abiInterface(plan.step.kind === 'wrapper' ? W : plan.step.kind === 'direct' ? D : plan.step.kind === 'pad' ? plan.pad.abi : 'abis/gang/wbnb.json');
    const parsed = abi.parseTransaction({ data: plan.transaction.inputData });
    let asset = plan.intent.token, symbol = plan.summary.expectedOutput.symbol, decimals = plan.decimals, output = 0n;
    if (plan.step.kind === 'wrap' || plan.step.kind === 'unwrap') {
      for (const log of receipt.logs ?? []) if (same(log.address, T.wrappedNative)) { try { const e = abi.parseLog(log); if (e.name === (plan.step.kind === 'wrap' ? 'Deposit' : 'Withdrawal') && same(e.args[0], plan.wallet) && e.args.wad === BigInt(plan.transaction.valueWei === '0' ? parsed.args[0] : plan.transaction.valueWei)) output += e.args.wad; } catch { /* Unrelated event. */ } }
      asset = plan.step.kind === 'wrap' ? T.wrappedNative : ZeroAddress; decimals = 18;
    } else if (plan.intent.side === 'buy' || plan.step.kind === 'pad' && plan.pad.kind === 'quote') {
      if (plan.intent.side === 'sell') { asset = plan.settlement.address; decimals = plan.settlement.decimals; }
      for (const log of receipt.logs ?? []) if (same(log.address, asset)) { try { const e = erc20.parseLog(log); if (e.name === 'Transfer') { if (same(e.args.to, plan.wallet)) output += e.args.value; if (same(e.args.from, plan.wallet)) output -= e.args.value; } } catch { /* Unrelated event. */ } }
    } else if (plan.step.kind === 'wrapper') {
      for (const log of receipt.logs ?? []) if (same(log.address, this.wrapperDeployment.wrapper.address)) { try { const e = abi.parseLog(log); if (e.name === 'ImportedTokenTrade' && !e.args.isBuy && same(e.args.trader, plan.wallet) && same(e.args.recipient, plan.wallet) && same(e.args.token, plan.intent.token) && e.args.sourceType === parsed.args.sourceType && e.args.sourceHash === keccak256(parsed.args.sourceData)) output += e.args.netNativeAmount; } catch { /* Unrelated event. */ } }
      asset = ZeroAddress; decimals = 18;
    } else if (plan.step.kind === 'direct') {
      const wrapped = await abiInterface('abis/gang/wbnb.json');
      for (const log of receipt.logs ?? []) if (same(log.address, T.wrappedNative)) { try { const e = wrapped.parseLog(log); if (e.name === 'Withdrawal' && same(e.args.src, T.dex.v2Router)) output += e.args.wad; } catch { /* Unrelated event. */ } }
      asset = ZeroAddress; decimals = 18;
    }
    return output > 0n ? { amount: formatUnits(output, decimals), symbol, assetAddress: asset } : null;
  }

  async nextApproval(q, wallet) {
    if (['wrap', 'unwrap'].includes(q.step.kind) || q.side === 'buy' && q.step.kind !== 'pad' || q.side === 'buy' && q.info.pad.kind === 'native') return null;
    const token = q.side === 'buy' ? q.info.quoteAsset.address : q.info.token;
    const spender = q.step.kind === 'pad' ? q.info.pad.address : q.step.kind === 'wrapper' ? this.wrapperDeployment.wrapper.address : T.dex.v2Router;
    const current = val(await this.reader.batch(q.info.snapshot, [spec('allowance', token, E, 'allowance', [wallet, spender])]), 'allowance');
    if (current >= q.amountIn) return null;
    const amount = current > 0n ? 0n : q.amountIn;
    return { transaction: tx(await abiInterface(E), 'approve', [spender, amount], token, wallet), scope: { token, spender, amount: amount.toString(), purpose: amount === 0n ? 'Reset the existing allowance.' : 'Approve this step amount.' } };
  }
}
