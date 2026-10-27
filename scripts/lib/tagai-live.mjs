import { AbiCoder, ZeroAddress, formatUnits, getAddress, isAddress, keccak256, parseUnits } from 'ethers';
import { abiInterface, encodeTagai, minimumOutput, tagaiRegistry } from './tagai.mjs';
import { ChainReader, TradeError, requireTrade } from './live-rpc.mjs';

const R = tagaiRegistry();
const T = 'abis/tagai/token-v16.json';
const P = 'abis/tagai/read-interfaces.json';
const D = 'abis/tagai/pancake.json';
const E = 'abis/erc20.json';
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const call = (label, target, abi, method, args = [], required = true) => ({ label, target, abi, method, args, required });
const value = (data, label) => data[label]?.value;
const present = (data, label) => data[label]?.ok === true;
const poolType = 'tuple(address currency0,address currency1,address hooks,address poolManager,uint24 fee,bytes32 parameters)';
const coder = AbiCoder.defaultAbiCoder();

function positiveAmount(input, decimals) {
  requireTrade(typeof input === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(input), 'INVALID_AMOUNT', 'Specify a positive token amount.');
  let amount;
  try { amount = parseUnits(input, decimals); } catch { throw new TradeError('INVALID_AMOUNT', 'The amount has more decimal places than the asset supports.'); }
  requireTrade(amount > 0n, 'INVALID_AMOUNT', 'The amount must be greater than zero.');
  return amount;
}

export class TagaiLive {
  constructor({ reader = new ChainReader(), fetcher = fetch, apiUrl = process.env.TAGAI_API_URL || 'https://bsc-api.tagai.fun', now = () => Math.floor(Date.now() / 1000) } = {}) {
    this.reader = reader;
    this.fetcher = fetcher;
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.now = now;
  }

  async search(ticker) {
    requireTrade(typeof ticker === 'string' && ticker.trim().length > 0 && ticker.length <= 100, 'INVALID_TOKEN', 'Provide a token name, ticker, or contract address.');
    let response;
    try {
      response = await this.fetcher(`${this.apiUrl}/community/search?tick=${encodeURIComponent(ticker.trim())}`, { headers: { 'X-Chain-Id': '56' }, signal: AbortSignal.timeout(15000) });
    } catch { throw new TradeError('SEARCH_UNAVAILABLE', 'Token search is unavailable. Retry or use the token contract address.'); }
    requireTrade(response.ok, 'SEARCH_UNAVAILABLE', 'Token search is unavailable. Retry or use the token contract address.');
    const rows = await response.json();
    requireTrade(Array.isArray(rows), 'SEARCH_UNAVAILABLE', 'Token search returned an incomplete response.');
    const unique = new Map();
    for (const row of rows) {
      if (Number(row.chainId) !== 56 || !isAddress(row.token)) continue;
      const address = getAddress(row.token);
      if (!unique.has(address)) unique.set(address, { symbol: String(row.tick || ''), name: String(row.name || row.tick || ''), contractAddress: address, platform: row.isImport === true || Number(row.isImport) === 1 ? 'Imported token' : 'TagAI' });
    }
    return Array.from(unique.values());
  }

  async resolve(input) {
    requireTrade(typeof input === 'string' && input.trim().length > 0, 'INVALID_TOKEN', 'Provide a token ticker or contract address.');
    input = input.trim();
    if (/^0x/i.test(input)) requireTrade(isAddress(input), 'INVALID_TOKEN_ADDRESS', 'The contract address or its checksum is invalid. Check the full address.');
    if (isAddress(input)) return { address: getAddress(input) };
    const rows = await this.search(input);
    const exact = rows.filter(row => row.symbol.toLowerCase() === input.trim().toLowerCase());
    if (exact.length === 1) return { address: exact[0].contractAddress };
    requireTrade(rows.length > 0, 'TOKEN_NOT_FOUND', 'No matching token was found. Check the ticker or provide its contract address.');
    throw new TradeError('TOKEN_AMBIGUOUS', 'Several tokens match this name. Select the contract address to continue.', { candidates: (exact.length ? exact : rows).slice(0, 3) });
  }

  async inspect(input, { wallet = null, snapshot: providedSnapshot = null } = {}) {
    const { address: token } = await this.resolve(input);
    if (wallet) wallet = getAddress(wallet);
    const snapshot = providedSnapshot ?? await this.reader.snapshot();
    const proofs = R.versions.filter(v => v.issuanceGetterDocumented && v.marketFamily !== 'import');
    const issuers = await this.reader.batch(snapshot, proofs.map(v => call(`issuer:${v.id}`, v.pump, P, 'createdTokens', [token], false)));
    const matches = proofs.filter(v => value(issuers, `issuer:${v.id}`) === true);
    requireTrade(matches.length === 1, matches.length > 1 ? 'ISSUER_AMBIGUOUS' : 'ISSUER_UNVERIFIED', 'The issuing platform could not be verified for this token. No trade was prepared.');
    const release = matches[0];
    requireTrade(release.supported === true && !['5', '8'].includes(release.id), 'TOKEN_ROUTE_UNAVAILABLE', 'This token cannot currently be traded through this connection.');
    const modern = Number(release.onChainVersion) >= 13;
    const specs = [call('name', token, E, 'name', [], false), call('symbol', token, E, 'symbol', [], false), call('decimals', token, E, 'decimals'),
      call('listed', token, T, 'listed'), call('pending', token, T, 'listingPending', [], modern), call('supply', token, T, 'bondingCurveSupply'),
      call('curve', token, T, 'bondingCurve', [], modern), call('buyFees', token, T, 'getBuyFeeRatios', [], modern),
      call('sellFees', release.pump, P, 'getFeeRatio'), call('implementation', release.pump, P, 'tokenImplementation', [], Boolean(release.tokenImplementation))];
    if (wallet) specs.push(call('balance', token, E, 'balanceOf', [wallet]));
    const state = await this.reader.batch(snapshot, specs);
    const decimals = Number(value(state, 'decimals'));
    requireTrade(Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, 'TOKEN_UNITS_UNVERIFIED', 'Token units could not be verified.');
    if (release.tokenImplementation) {
      requireTrade(same(value(state, 'implementation'), release.tokenImplementation), 'TOKEN_IDENTITY_CHANGED', 'The token deployment changed and needs verification before trading.');
      const code = await this.reader.rpc('eth_getCode', [token, snapshot.blockTag]);
      const clone = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
      requireTrade(clone && same(`0x${clone[1]}`, release.tokenImplementation), 'TOKEN_IDENTITY_UNVERIFIED', 'The token implementation could not be verified.');
    }
    const listed = value(state, 'listed');
    requireTrade(typeof listed === 'boolean', 'INCOMPLETE_STATE', 'The token market state is unavailable.');
    const phase = listed ? 'external' : value(state, 'pending') === true ? 'migrating' : 'internal';
    const curve = present(state, 'curve') ? value(state, 'curve') : release.pump;
    requireTrade(same(curve, release.pump), 'CURVE_UNVERIFIED', 'The token pricing contract could not be verified.');
    const info = { token, release, snapshot, state, decimals, curve, phase, wallet, modern, symbol: present(state, 'symbol') ? value(state, 'symbol') : null };
    let priceWei = null;
    if (phase === 'internal') {
      const price = await this.reader.batch(snapshot, [call('price', curve, P, 'getPrice', [value(state, 'supply'), 10n ** BigInt(decimals)])]);
      priceWei = value(price, 'price');
    } else if (phase === 'external') {
      await this.loadPool(info);
      if (info.pool?.kind === 'infinity') priceWei = (2n ** 192n * 10n ** BigInt(decimals)) / (info.pool.sqrtPriceX96 ** 2n);
      else if (info.pool?.kind === 'v2') priceWei = info.pool.nativeReserve * 10n ** BigInt(decimals) / info.pool.tokenReserve;
    }
    await this.reader.verifySnapshot(snapshot);
    info.summary = {
      name: present(state, 'name') ? value(state, 'name') : info.symbol,
      symbol: info.symbol, contractAddress: token, platform: 'TagAI', network: 'BNB Smart Chain', market: phase,
      referencePrice: priceWei === null ? null : { amount: formatUnits(priceWei, 18), currency: 'BNB', perToken: '1', includesTradingFees: false },
      internalProgressPercent: !listed && modern && decimals === 18 ? formatUnits(value(state, 'supply') * 10000n / (650000000n * 10n ** 18n), 2) : null,
      observedAt: new Date(snapshot.timestamp * 1000).toISOString(),
    };
    return info;
  }

  async loadPool(info) {
    const { token, snapshot, release } = info;
    if (release.marketFamily === 'v2') {
      const first = await this.reader.batch(snapshot, [call('factory', R.dex.v2Router, D, 'factory'), call('wrapped', R.dex.v2Router, D, 'WETH'), call('pair', R.dex.v2Factory, D, 'getPair', [token, R.wrappedNative])]);
      requireTrade(same(value(first, 'factory'), R.dex.v2Factory) && same(value(first, 'wrapped'), R.wrappedNative) && !same(value(first, 'pair'), ZeroAddress), 'POOL_UNAVAILABLE', 'A supported trading pool is unavailable for this token.');
      const pair = value(first, 'pair');
      const second = await this.reader.batch(snapshot, [call('pairFactory', pair, D, 'factory'), call('token0', pair, D, 'token0'), call('token1', pair, D, 'token1'), call('reserves', pair, D, 'getReserves')]);
      const t0 = value(second, 'token0'), t1 = value(second, 'token1');
      requireTrade(same(value(second, 'pairFactory'), R.dex.v2Factory) && ((same(t0, token) && same(t1, R.wrappedNative)) || (same(t1, token) && same(t0, R.wrappedNative))), 'POOL_UNVERIFIED', 'The trading pool could not be verified.');
      const reserves = value(second, 'reserves');
      const tokenReserve = same(t0, token) ? reserves[0] : reserves[1];
      const nativeReserve = same(t0, token) ? reserves[1] : reserves[0];
      requireTrade(tokenReserve > 0n && nativeReserve > 0n, 'NO_LIQUIDITY', 'The trading pool has no usable liquidity.');
      info.pool = { kind: 'v2', pair, tokenReserve, nativeReserve };
      return;
    }
    const specs = [call('poolId', token, T, 'v4PoolId'), call('manager', R.dex.clPoolManager, D, 'vault')];
    if (info.modern) specs.push(call('boundHook', token, T, 'listingHook'), call('boundParameters', token, T, 'listingPoolParameters'), call('boundManager', token, T, 'clPoolManager'), call('boundVault', token, T, 'vault'));
    const first = await this.reader.batch(snapshot, specs);
    requireTrade(same(value(first, 'manager'), R.dex.vault), 'POOL_UNVERIFIED', 'The trading pool infrastructure could not be verified.');
    const poolId = value(first, 'poolId');
    const second = await this.reader.batch(snapshot, [call('key', R.dex.clPoolManager, D, 'poolIdToPoolKey', [poolId]), call('slot', R.dex.clPoolManager, D, 'getSlot0', [poolId]), call('liquidity', R.dex.clPoolManager, D, 'getLiquidity', [poolId])]);
    const rawKey = value(second, 'key');
    const key = { currency0: rawKey[0], currency1: rawKey[1], hooks: rawKey[2], poolManager: rawKey[3], fee: Number(rawKey[4]), parameters: rawKey[5] };
    requireTrade(same(key.currency0, ZeroAddress) && same(key.currency1, token) && same(key.poolManager, R.dex.clPoolManager) && same(keccak256(coder.encode([poolType], [key])), poolId), 'POOL_UNVERIFIED', 'A compatible BNB trading pool could not be verified.');
    if (release.hook) requireTrade(same(key.hooks, release.hook), 'POOL_UNVERIFIED', 'The token trading pool needs updated verification.');
    if (info.modern) requireTrade(same(value(first, 'boundHook'), key.hooks) && value(first, 'boundParameters') === key.parameters && same(value(first, 'boundManager'), R.dex.clPoolManager) && same(value(first, 'boundVault'), R.dex.vault), 'POOL_UNVERIFIED', 'The token trading pool does not match its listing record.');
    const sqrtPriceX96 = value(second, 'slot')[0];
    requireTrade(sqrtPriceX96 > 0n && value(second, 'liquidity') > 0n, 'NO_LIQUIDITY', 'The trading pool has no usable liquidity.');
    info.pool = { kind: 'infinity', key, poolId, sqrtPriceX96 };
  }

  async quote({ token: input, side, amount, wallet = null, slippageBps = 100, subject = ZeroAddress, recipient = null, snapshot = null }) {
    requireTrade(['buy', 'sell'].includes(side), 'INVALID_DIRECTION', 'Choose buy or sell.');
    requireTrade(Number.isInteger(slippageBps) && slippageBps >= 0 && slippageBps < 10000, 'INVALID_SLIPPAGE', 'Slippage must be between 0 and 9999 basis points.');
    const info = await this.inspect(input, { wallet, snapshot });
    requireTrade(info.phase !== 'migrating', 'MARKET_MIGRATING', 'This token is moving to its trading pool. Wait for trading to reopen.');
    let amountIn;
    if (side === 'sell' && typeof amount === 'string' && amount.endsWith('%')) {
      requireTrade(wallet, 'WALLET_REQUIRED', 'Connect your wallet to calculate a percentage of its holdings.');
      const fraction = positiveAmount(amount.slice(0, -1), 2);
      requireTrade(fraction <= 10000n, 'INVALID_AMOUNT', 'The holding percentage cannot exceed 100%.');
      amountIn = value(info.state, 'balance') * fraction / 10000n;
      requireTrade(amountIn > 0n, 'INSUFFICIENT_BALANCE', 'The selected holding amount is zero.');
    } else amountIn = positiveAmount(amount, side === 'buy' ? 18 : info.decimals);
    if (wallet && side === 'sell') requireTrade(value(info.state, 'balance') >= amountIn, 'INSUFFICIENT_BALANCE', 'The wallet does not hold enough of this token.');
    let quoteOut, fees = null, refund = 0n;
    if (info.phase === 'internal') {
      if (side === 'buy' && info.release.requiresBuyerHandle && wallet) {
        const eligibility = await this.reader.batch(info.snapshot, [call('handle', R.handleRegistry, P, 'handleOf', [getAddress(wallet)])]);
        requireTrade(typeof value(eligibility, 'handle') === 'string' && value(eligibility, 'handle').length > 0, 'BUYER_INELIGIBLE', 'This wallet does not yet meet the token market’s buying requirements. Selling is unaffected.');
      }
      const supply = value(info.state, 'supply');
      if (side === 'buy') {
        requireTrade(present(info.state, 'buyFees'), 'QUOTE_UNAVAILABLE', 'The token’s current trading fees could not be read.');
        const ratios = value(info.state, 'buyFees');
        const platform = amountIn * ratios[0] / 10000n, subjectFee = amountIn * ratios[1] / 10000n;
        requireTrade(platform + subjectFee < amountIn, 'QUOTE_UNAVAILABLE', 'Trading fees leave no usable purchase amount.');
        const quoted = await this.reader.batch(info.snapshot, [call('out', info.curve, P, 'getBuyAmountByValue', [supply, amountIn - platform - subjectFee])]);
        quoteOut = value(quoted, 'out');
        fees = { currency: 'BNB', amount: formatUnits(platform + subjectFee, 18), includedInQuote: true };
        if (info.modern) {
          const remaining = 650000000n * 10n ** 18n - supply;
          if (quoteOut >= remaining) {
            const cap = await this.reader.batch(info.snapshot, [call('capPrice', info.curve, P, 'getPrice', [supply, remaining])]);
            const used = value(cap, 'capPrice') * 10000n / (10000n - ratios[0] - ratios[1]);
            requireTrade(remaining > 0n && used <= amountIn, 'QUOTE_UNAVAILABLE', 'The market is completing its initial sale. Refresh the quote.');
            quoteOut = remaining;
            refund = amountIn - used;
            fees.amount = formatUnits(used * ratios[0] / 10000n + used * ratios[1] / 10000n, 18);
          }
        }
      } else {
        requireTrade(amountIn <= supply, 'INVALID_AMOUNT', 'The selected sell amount exceeds the market’s available supply.');
        const gross = await this.reader.batch(info.snapshot, [call('gross', info.curve, P, 'getPrice', [supply - amountIn, amountIn])]);
        const ratios = value(info.state, 'sellFees');
        const platform = value(gross, 'gross') * ratios[0] / 10000n, subjectFee = value(gross, 'gross') * ratios[1] / 10000n;
        quoteOut = value(gross, 'gross') - platform - subjectFee;
        fees = { currency: 'BNB', amount: formatUnits(platform + subjectFee, 18), includedInQuote: true };
      }
    } else if (info.pool.kind === 'v2') {
      const path = side === 'buy' ? [R.wrappedNative, info.token] : [info.token, R.wrappedNative];
      const quoted = await this.reader.batch(info.snapshot, [call('amounts', R.dex.v2Router, D, 'getAmountsOut', [amountIn, path])]);
      const amounts = value(quoted, 'amounts');
      requireTrade(amounts.length === 2 && amounts[0] === amountIn, 'QUOTE_UNAVAILABLE', 'The pool returned an invalid quote.');
      quoteOut = amounts[1];
    } else {
      const hookData = same(subject, ZeroAddress) ? '0x' : coder.encode(['address'], [getAddress(subject)]);
      const quoted = await this.reader.batch(info.snapshot, [call('out', R.dex.clQuoter, D, 'quoteExactInputSingle', [{ poolKey: info.pool.key, zeroForOne: side === 'buy', exactAmount: amountIn, hookData }])]);
      quoteOut = value(quoted, 'out')[0];
    }
    requireTrade(quoteOut > 0n, 'QUOTE_UNAVAILABLE', 'No executable output is available for this amount.');
    await this.reader.verifySnapshot(info.snapshot);
    requireTrade(this.now() < info.snapshot.timestamp + 60, 'QUOTE_EXPIRED', 'The quote expired while data was loading. Refresh it before trading.');
    const minimum = minimumOutput(quoteOut.toString(), slippageBps);
    const summary = {
      ...info.summary, side,
      input: { amount: formatUnits(amountIn, side === 'buy' ? 18 : info.decimals), symbol: side === 'buy' ? 'BNB' : info.symbol },
      expectedOutput: { amount: formatUnits(quoteOut, side === 'buy' ? info.decimals : 18), symbol: side === 'buy' ? info.symbol : 'BNB' },
      minimumOutput: { amount: formatUnits(minimum, side === 'buy' ? info.decimals : 18), symbol: side === 'buy' ? info.symbol : 'BNB' },
      slippagePercent: formatUnits(BigInt(slippageBps), 2), fees, gasIncluded: false,
      expectedBnbRefund: refund > 0n ? formatUnits(refund, 18) : null,
      expiresAt: new Date(Math.min(this.now() + 60, info.snapshot.timestamp + 60) * 1000).toISOString(),
    };
    return { info, side, amountIn, quoteOut, minimum, slippageBps, subject: getAddress(subject), recipient: recipient ? getAddress(recipient) : wallet, summary };
  }

  async transaction(quote, wallet) {
    const { info } = quote;
    const kind = info.phase === 'internal' ? 'internal' : info.pool.kind === 'v2' ? 'v2' : 'infinity';
    requireTrade(kind === 'v2' || !quote.recipient || same(quote.recipient, wallet), 'RECIPIENT_UNSUPPORTED', 'This trading route delivers to the connected wallet. A different receiving address cannot be used.');
    const prepared = await encodeTagai({ chainId: 56, kind, version: info.release.id, side: quote.side, wallet,
      recipient: quote.recipient ?? wallet, subject: quote.subject, token: info.token,
      amountIn: quote.amountIn.toString(), quoteOut: quote.quoteOut.toString(), slippageBps: quote.slippageBps,
      deadline: this.now() + 180, poolKey: info.pool?.key }, { now: this.now() });
    return prepared.transaction;
  }

  async nextApproval(quote, wallet) {
    if (quote.side !== 'sell' || quote.info.phase !== 'external') return null;
    const spender = quote.info.pool.kind === 'v2' ? R.dex.v2Router : R.dex.permit2;
    const specs = [call('allowance', quote.info.token, E, 'allowance', [wallet, spender])];
    if (quote.info.pool.kind === 'infinity') specs.push(call('permit', R.dex.permit2, D, 'allowance', [wallet, quote.info.token, R.dex.universalRouter]));
    const data = await this.reader.batch(quote.info.snapshot, specs);
    if (value(data, 'allowance') < quote.amountIn) {
      const encoded = await encodeTagai({ chainId: 56, kind: 'erc20-approval', wallet, token: quote.info.token, amountIn: quote.amountIn.toString(), spender });
      return { transaction: encoded.transaction, kind: 'APPROVAL', scope: { token: quote.info.symbol, amount: formatUnits(quote.amountIn, quote.info.decimals), purpose: 'Allow this trade to use the selected token amount.' } };
    }
    if (quote.info.pool.kind === 'infinity') {
      const permit = value(data, 'permit');
      if (permit[0] < quote.amountIn || Number(permit[1]) <= this.now() + 180) {
        const encoded = await encodeTagai({ chainId: 56, kind: 'permit2-approval', wallet, token: quote.info.token, amountIn: quote.amountIn.toString(), expiration: this.now() + 600 });
        return { transaction: encoded.transaction, kind: 'APPROVAL', scope: { token: quote.info.symbol, amount: formatUnits(quote.amountIn, quote.info.decimals), expiresAt: new Date((this.now() + 600) * 1000).toISOString(), purpose: 'Authorize the selected trading amount for a limited time.' } };
      }
    }
    return null;
  }
}
