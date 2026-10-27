import { getAddress, isAddress } from 'ethers';
import { requireTrade } from './live-rpc.mjs';

export function normalizeTokenInput(input) {
  requireTrade(typeof input === 'string' && input.trim(), 'INVALID_TOKEN', 'Provide a token ticker, contract address or supported BSC token link.');
  const text = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  let url;
  try { url = new URL(text); } catch { /* Reject malformed links below. */ }
  requireTrade(url && url.protocol === 'https:' && ['flap.sh', 'www.flap.sh', 'gang.fun'].includes(url.hostname)
    && !url.username && !url.password && !url.port, 'INVALID_TOKEN_URL', 'Provide a valid supported HTTPS BSC token link.');
  const path = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  requireTrade(path, 'INVALID_TOKEN_URL', 'Use /bnb/<contract-address> on Flap or /token/<contract-address> on GANG.');
  requireTrade(path[1] === (url.hostname === 'gang.fun' ? 'token' : 'bnb'), 'WRONG_CHAIN', 'This skill requires a BNB Smart Chain token link.');
  requireTrade(isAddress(path[2]), 'INVALID_TOKEN_ADDRESS', 'The token address or its checksum in the link is invalid.');
  return getAddress(path[2]);
}
