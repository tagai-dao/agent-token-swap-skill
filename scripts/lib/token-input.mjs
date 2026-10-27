import { getAddress, isAddress } from 'ethers';
import { requireTrade } from './live-rpc.mjs';

export function normalizeTokenInput(input) {
  requireTrade(typeof input === 'string' && input.trim(), 'INVALID_TOKEN', 'Provide a token ticker, contract address or Flap BNB token link.');
  const text = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  let url;
  try { url = new URL(text); } catch { /* Reject malformed links below. */ }
  requireTrade(url && url.protocol === 'https:' && ['flap.sh', 'www.flap.sh'].includes(url.hostname)
    && !url.username && !url.password && !url.port, 'INVALID_TOKEN_URL', 'Provide a valid HTTPS Flap BNB token link.');
  const path = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  requireTrade(path, 'INVALID_TOKEN_URL', 'Use a Flap token link with /bnb/<contract-address>.');
  requireTrade(path[1] === 'bnb', 'WRONG_CHAIN', 'This skill requires a BNB Smart Chain token link.');
  requireTrade(isAddress(path[2]), 'INVALID_TOKEN_ADDRESS', 'The token address or its checksum in the link is invalid.');
  return getAddress(path[2]);
}
