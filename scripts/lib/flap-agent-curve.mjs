import { readFile } from 'node:fs/promises';
import { ZeroAddress, formatUnits, getAddress, keccak256, parseUnits } from 'ethers';
import { abiInterface, minimumOutput } from './tagai.mjs';
import { requireTrade } from './live-rpc.mjs';

const C = JSON.parse(await readFile(new URL('../../config/flap-bsc.json', import.meta.url), 'utf8')).agentCurve;
const A = C.identities, ABI = C.abi;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const call = (label, target, method, args = []) => ({ label, target, abi: ABI, method, args, required: true });
const value = (rows, key) => rows[key].value;
const proxySlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const agentCurveProofs = input => [call('flap:agent-market', A.factory.address, 'isMarket', [input]), call('flap:agent-token', A.factory.address, 'marketOfToken', [input])];

export class FlapAgentCurve {
  constructor({ reader, now, deployment = C }) { this.reader = reader; this.now = now; this.registry = deployment; }

  async identify(input, snapshot) {
    const rows = await this.reader.batch(snapshot, agentCurveProofs(input));
    const market = value(rows, 'flap:agent-market') ? input : value(rows, 'flap:agent-token');
    if (same(market, ZeroAddress)) return null;
    const rows2 = await this.reader.batch(snapshot, [call('registered', this.registry.identities.factory.address, 'isMarket', [market]), call('phase', market, 'phase'), call('token', market, 'token'), call('predicted', market, 'predictedToken')]);
    requireTrade(value(rows2, 'registered') && (same(input, market) || same(input, value(rows2, 'token')) || same(input, value(rows2, 'predicted'))), 'MARKET_UNVERIFIED', 'The pre-launch market binding could not be verified.');
    // An actual launched token follows ordinary Flap/DEX routing. A market
    // address continues to refer to its own ledger and claim state.
    if (!same(input, market) && value(rows2, 'phase') === 3n && same(input, value(rows2, 'token'))) return null;
    return getAddress(market);
  }

  async verify(snapshot) {
    for (const name of ['factory', 'portal', 'reader']) {
      const record = this.registry.identities[name];
      const code = await this.reader.rpc('eth_getCode', [record.address, snapshot.blockTag]);
      requireTrade(keccak256(code) === record.runtimeHash, 'PLATFORM_CHANGED', 'The pre-launch trading contract changed and needs updated verification.');
      const slot = await this.reader.rpc('eth_getStorageAt', [record.address, proxySlot, snapshot.blockTag]);
      requireTrade(same(`0x${slot.slice(-40)}`, record.implementation), 'PLATFORM_CHANGED', 'The pre-launch trading connection was upgraded. Update the integration before trading.');
      const implementation = await this.reader.rpc('eth_getCode', [record.implementation, snapshot.blockTag]);
      requireTrade(keccak256(implementation) === record.implementationRuntimeHash, 'PLATFORM_CHANGED', 'The pre-launch implementation could not be verified.');
    }
    const bindings = await this.reader.batch(snapshot, [call('reader', this.registry.identities.reader.address, 'factory'), call('portal', this.registry.identities.portal.address, 'factory'),
      call('beacon', this.registry.identities.factory.address, 'marketBeacon'), call('implementation', this.registry.identities.marketBeacon.address, 'implementation')]);
    requireTrade(same(value(bindings, 'reader'), this.registry.identities.factory.address) && same(value(bindings, 'portal'), this.registry.identities.factory.address)
      && same(value(bindings, 'beacon'), this.registry.identities.marketBeacon.address) && same(value(bindings, 'implementation'), this.registry.identities.marketImplementation.address), 'MARKET_UNVERIFIED', 'The pre-launch market infrastructure could not be verified.');
    const implCode = await this.reader.rpc('eth_getCode', [this.registry.identities.marketImplementation.address, snapshot.blockTag]);
    requireTrade(keccak256(implCode) === this.registry.identities.marketImplementation.runtimeHash, 'PLATFORM_CHANGED', 'The pre-launch market implementation changed.');
  }

  async search(ticker) {
    const snapshot = await this.reader.snapshot();
    const bindings = await this.reader.batch(snapshot, [call('reader', this.registry.identities.reader.address, 'factory'), call('total', this.registry.identities.factory.address, 'marketCount')]);
    requireTrade(same(value(bindings, 'reader'), this.registry.identities.factory.address), 'MARKET_UNVERIFIED', 'The market search registry could not be verified.');
    const total = value(bindings, 'total');
    requireTrade(total <= 1000n, 'SEARCH_INCOMPLETE', 'This market search needs an indexer with complete coverage. Use its contract address.');
    const matches = [];
    for (let end = total; end > 0n;) {
      const start = end > 16n ? end - 16n : 0n;
      const page = await this.reader.batch(snapshot, [call('page', this.registry.identities.reader.address, 'marketPage', [start, end - start])]);
      const addresses = value(page, 'page')[0];
      requireTrade(BigInt(addresses.length) === end - start && value(page, 'page')[2] === total, 'SEARCH_INCOMPLETE', 'The market search returned an incomplete registry page.');
      const rows = await this.reader.batch(snapshot, [call('cards', this.registry.identities.reader.address, 'marketCards', [addresses])]);
      const cards = value(rows, 'cards');
      requireTrade(cards.length === addresses.length && cards.every((card, index) => same(card.market, addresses[index])), 'SEARCH_INCOMPLETE', 'The market search returned inconsistent addresses.');
      for (const card of [...cards].reverse()) {
        if (!`${card.name} ${card.symbol}`.toLowerCase().includes(ticker.toLowerCase())) continue;
        matches.push({ name: card.name, symbol: card.symbol, contractAddress: card.phase === 3n ? card.token : card.market, marketAddress: card.market, predictedToken: card.predictedToken, platform: 'Flap', assetKind: card.phase === 3n ? 'token' : 'pre-launch shares' });
      }
      end = start;
    }
    await this.reader.verifySnapshot(snapshot);
    return matches;
  }

  async inspect(market, snapshot, wallet) {
    await this.verify(snapshot);
    const calls = [call('registered', this.registry.identities.factory.address, 'isMarket', [market]), call('portal', market, 'portal'),
      call('detail', this.registry.identities.reader.address, 'marketDetail', [market]), call('settings', this.registry.identities.reader.address, 'marketSettings', [market])];
    if (wallet) calls.push(call('position', this.registry.identities.reader.address, 'userPosition', [market, wallet]));
    const rows = await this.reader.batch(snapshot, calls);
    const detail = value(rows, 'detail'), settings = value(rows, 'settings');
    requireTrade(value(rows, 'registered') && same(value(rows, 'portal'), this.registry.identities.portal.address) && same(detail.market, market)
      && same(detail.quoteToken, settings.quoteToken) && detail.quoteDecimals === settings.quoteDecimals && detail.capRaw === settings.capRaw,
    'MARKET_UNVERIFIED', 'The pre-launch market does not match its registered settings.');
    requireTrade([1n, 2n, 3n].includes(detail.phase) && detail.capRaw > 0n, 'MARKET_UNAVAILABLE', 'The pre-launch market state is unavailable.');
    const metadata = same(detail.quoteToken, ZeroAddress) ? null : await this.reader.batch(snapshot, [{ label: 'symbol', target: detail.quoteToken, abi: 'abis/erc20.json', method: 'symbol', args: [], required: true }]);
    const quoteSymbol = metadata ? value(metadata, 'symbol') : 'BNB';
    const wad = 10n ** 18n, supply = detail.totalShares;
    const remaining = 1000000000n * wad + settings.curveH - supply;
    const squared = remaining > 0n ? remaining * remaining / wad : 0n;
    const price = detail.phase === 1n && squared > 0n ? settings.curveK * wad / squared : null;
    const info = { token: market, market, snapshot, wallet, decimals: 18, symbol: settings.launch.symbol, phase: 'internal', agentCurve: true, detail, settings,
      position: wallet ? value(rows, 'position') : null, release: { tokenAbi: ABI }, quoteAsset: { address: detail.quoteToken, symbol: quoteSymbol, decimals: Number(detail.quoteDecimals) } };
    info.summary = { name: settings.launch.name, symbol: info.symbol, contractAddress: detail.phase === 3n ? detail.token : detail.predictedToken, marketAddress: market,
      platform: 'Flap', network: 'BNB Smart Chain', market: detail.phase === 1n ? 'internal' : detail.phase === 2n ? 'migrating' : 'launched', assetKind: 'pre-launch shares',
      tokenDeployed: detail.phase === 3n, referencePrice: price === null ? null : { amount: formatUnits(price, 18), currency: quoteSymbol, perShare: '1', includesTradingFees: false },
      internalProgressPercent: formatUnits(detail.progressBps, 2), observedAt: new Date(snapshot.timestamp * 1000).toISOString() };
    await this.reader.verifySnapshot(snapshot);
    return info;
  }

  async quote(info, { side, amount, wallet, slippageBps, recipient }) {
    requireTrade(info.detail.phase === 1n, 'MARKET_CLOSED', 'This pre-launch market is closed. Its shares cannot be sold through the token’s later trading pool.');
    requireTrade(same(info.quoteAsset.address, ZeroAddress), 'SETTLEMENT_ROUTE_UNAVAILABLE', 'This pre-launch market needs an additional verified BNB conversion route.');
    requireTrade(!recipient || (wallet && same(recipient, wallet)), 'RECIPIENT_UNSUPPORTED', 'Pre-launch shares belong to the connected wallet.');
    const abi = await abiInterface(ABI);
    let amountIn, quoteOut, shareBps = null, refund = 0n, fee = 0n;
    if (side === 'buy') {
      requireTrade(wallet, 'WALLET_REQUIRED', 'Connect the wallet to check its pre-launch buying eligibility and available capacity.');
      const handle = await this.reader.batch(info.snapshot, [{ label: 'handle', target: this.registry.agentId, abi: 'abis/tagai/read-interfaces.json', method: 'handleOf', args: [wallet], required: true }]);
      requireTrade(value(handle, 'handle').trim().length > 0 && info.position.eligibilityKnown && info.position.eligible, 'BUYER_INELIGIBLE', 'Buying in this market requires an Agent ID on the connected wallet. Selling and claiming do not.');
      requireTrade(typeof amount === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount), 'INVALID_AMOUNT', 'Specify a positive BNB amount.');
      amountIn = parseUnits(amount, 18);
      requireTrade(amountIn > 0n, 'INVALID_AMOUNT', 'The buying amount must be greater than zero.');
      const quoted = await this.reader.batch(info.snapshot, [call('quote', this.registry.identities.portal.address, 'quoteBuy', [info.market, wallet, amountIn])]);
      const out = value(quoted, 'quote');
      requireTrade(out.acceptedGross + out.refund === amountIn && out.shares <= info.position.remainingWalletShares, 'QUOTE_UNAVAILABLE', 'The pre-launch buy quote does not match this wallet’s capacity.');
      quoteOut = out.shares; refund = out.refund; fee = out.fee;
    } else {
      requireTrade(wallet && info.position.shares > 0n, 'INSUFFICIENT_BALANCE', 'This wallet has no pre-launch shares to sell.');
      requireTrade(typeof amount === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?%$/.test(amount), 'SHARE_PERCENTAGE_REQUIRED', 'Specify the percentage of pre-launch shares to sell, such as 50%.');
      shareBps = parseUnits(amount.slice(0, -1), 2);
      requireTrade(shareBps > 0n && shareBps <= 10000n, 'INVALID_AMOUNT', 'The holding percentage must be between 0.01% and 100%.');
      amountIn = info.position.shares * shareBps / 10000n;
      requireTrade(amountIn > 0n, 'INVALID_AMOUNT', 'The selected share amount is zero.');
      // This is a complete real-caller sale simulation, not a probe/state-read
      // fallback. Ledger ownership requires msg.sender; Multicall cannot sell
      // the user's position. The provisional floor is never sent or previewed.
      const simulated = await this.reader.simulate(info.snapshot, { from: wallet, to: this.registry.identities.portal.address, valueWei: '0', inputData: abi.encodeFunctionData('sellBps', [info.market, shareBps, 1n]) });
      quoteOut = abi.decodeFunctionResult('sellBps', simulated)[0];
    }
    requireTrade(quoteOut > 0n, 'QUOTE_UNAVAILABLE', 'No output is available for this pre-launch trade.');
    const minimum = minimumOutput(quoteOut.toString(), slippageBps);
    requireTrade(this.now() < info.snapshot.timestamp + 60, 'QUOTE_EXPIRED', 'The quote expired while loading. Refresh it.');
    await this.reader.verifySnapshot(info.snapshot);
    const summary = { ...info.summary, side, input: { amount: formatUnits(amountIn, 18), symbol: side === 'buy' ? 'BNB' : info.symbol, ...(side === 'sell' ? { unit: 'pre-launch shares', percentage: amount } : {}) },
      expectedOutput: { amount: formatUnits(quoteOut, 18), symbol: side === 'buy' ? info.symbol : 'BNB', ...(side === 'buy' ? { unit: 'pre-launch shares' } : {}) },
      minimumOutput: { amount: formatUnits(minimum, 18), symbol: side === 'buy' ? info.symbol : 'BNB' }, slippagePercent: formatUnits(BigInt(slippageBps), 2),
      expectedBnbRefund: refund ? formatUnits(refund, 18) : null, fees: { includedInQuote: true, amount: side === 'buy' ? formatUnits(fee, 18) : null, currency: 'BNB' }, gasIncluded: false,
      expiresAt: new Date((info.snapshot.timestamp + 60) * 1000).toISOString() };
    return { info, side, amountIn, quoteOut, minimum, shareBps, slippageBps, recipient: wallet, summary };
  }

  async transaction(quote, wallet) {
    const abi = await abiInterface(ABI);
    return { binanceChainId: '56', from: getAddress(wallet), to: this.registry.identities.portal.address, valueWei: quote.side === 'buy' ? quote.amountIn.toString() : '0',
      inputData: abi.encodeFunctionData(quote.side === 'buy' ? 'buy' : 'sellBps', quote.side === 'buy' ? [quote.info.market, quote.minimum] : [quote.info.market, quote.shareBps, quote.minimum]) };
  }
}
