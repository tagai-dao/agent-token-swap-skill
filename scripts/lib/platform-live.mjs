import { getAddress, isAddress } from 'ethers';
import { TagaiLive } from './tagai-live.mjs';
import { FlapLive, flapProof, decodeFlapProof } from './flap-live.mjs';
import { tagaiRegistry } from './tagai.mjs';
import { ChainReader, TradeError, requireTrade } from './live-rpc.mjs';
import { agentCurveProofs } from './flap-agent-curve.mjs';
import { normalizeTokenInput } from './token-input.mjs';
import { GangLive, gangProofs } from './gang-live.mjs';

const releases = tagaiRegistry().versions.filter(v => v.issuanceGetterDocumented && v.marketFamily !== 'import');

export class PlatformLive {
  constructor({ reader = new ChainReader(), fetcher = fetch, now } = {}) {
    this.reader = reader;
    this.adapters = { tagai: new TagaiLive({ reader, fetcher, ...(now ? { now } : {}) }), flap: new FlapLive({ reader, fetcher, ...(now ? { now } : {}) }), gang: new GangLive({ reader, fetcher, ...(now ? { now } : {}) }) };
  }

  async resolve(input, platform = null) {
    if (platform) requireTrade(Object.hasOwn(this.adapters, platform), 'PLATFORM_UNAVAILABLE', 'This issuing platform is not connected yet.');
    input = normalizeTokenInput(input);
    if (/^0x/i.test(input)) requireTrade(isAddress(input), 'INVALID_TOKEN_ADDRESS', 'The contract address or its checksum is invalid.');
    if (isAddress(input)) return getAddress(input);
    const rows = [], failures = [];
    // HTTP index queries are not contract reads. Keep each source's native order.
    for (const id of platform ? [platform] : Object.keys(this.adapters)) {
      try { rows.push(...await this.adapters[id].search(input)); } catch (error) { failures.push({ platform: id, code: error.code }); }
    }
    const unique = [...new Map(rows.map(row => [row.contractAddress.toLowerCase(), row])).values()];
    const exact = unique.filter(row => row.symbol.toLowerCase() === input.toLowerCase());
    if (exact.length === 1) return exact[0].contractAddress;
    if (!unique.length && failures.length) throw new TradeError('SEARCH_UNAVAILABLE', 'Token search is unavailable for a relevant platform. Retry or provide the contract address.');
    requireTrade(unique.length, 'TOKEN_NOT_FOUND', 'No matching token was found. Check the ticker or provide its address.');
    throw new TradeError('TOKEN_AMBIGUOUS', 'Several tokens match this name. Select the contract address to continue.', { candidates: (exact.length ? exact : unique).slice(0, 3), incompleteSearch: failures });
  }

  async select(input, { platform = null } = {}) {
    const token = await this.resolve(input, platform);
    const snapshot = await this.reader.snapshot();
    const calls = [flapProof(token), ...agentCurveProofs(token), ...releases.map(v => ({ label: `tagai:${v.id}`, target: v.pump, abi: 'abis/tagai/read-interfaces.json', method: 'createdTokens', args: [token], required: false })), ...gangProofs(token)];
    const proof = await this.reader.batch(snapshot, calls);
    const flap = await decodeFlapProof(proof['flap:issuer'], token);
    requireTrade(flap !== 'UNKNOWN', 'ISSUER_UNVERIFIED', 'Flap issuance could not be checked. Refresh the chain connection before trading.');
    const matches = [];
    if (flap === 'MATCH' || proof['flap:agent-market'].value || !/^0x0{40}$/i.test(proof['flap:agent-token'].value)) matches.push('flap');
    if (releases.some(v => proof[`tagai:${v.id}`].value === true)) matches.push('tagai');
    requireTrade(gangProofs(token).every(call => proof[call.label]?.ok), 'ISSUER_UNVERIFIED', 'GANG issuance could not be completely checked.');
    if (gangProofs(token).some(call => !/^0x0{40}$/i.test(proof[call.label].value[0]))) matches.push('gang');
    requireTrade(matches.length === 1, matches.length > 1 ? 'ISSUER_AMBIGUOUS' : 'ISSUER_UNVERIFIED', 'The issuing platform could not be uniquely verified. No trade was prepared.');
    requireTrade(!platform || platform === matches[0], 'PLATFORM_MISMATCH', 'The token’s verified issuer differs from the specified platform. Check the address.');
    return { adapter: this.adapters[matches[0]], token, snapshot };
  }

  async inspect(input, options = {}) {
    const { adapter, token, snapshot } = await this.select(input, options);
    return adapter.inspect(token, { ...options, snapshot });
  }

  async quote(intent) {
    const { adapter, token, snapshot } = await this.select(intent.token, intent);
    return adapter.quote({ ...intent, token, snapshot });
  }

  adapter(quote) { return this.adapters[quote.info.summary.platform.toLowerCase()]; }
  transaction(quote, wallet) { return this.adapter(quote).transaction(quote, wallet); }
  nextApproval(quote, wallet) { return this.adapter(quote).nextApproval(quote, wallet); }
  captureActualOutput(plan, receipt) { return this.adapters.gang.captureActualOutput(plan, receipt); }
}
