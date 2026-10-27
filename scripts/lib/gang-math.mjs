import { requireTrade } from './live-rpc.mjs';

export const GANG_VIRTUAL_TOKEN = 1066666666666666666666666667n;
const ceil = (a, b) => (a + b - 1n) / b;

export function gangBuy(curve, gross, room) {
  const { virtualQuote: vq, realQuote: raised, sold, gradAmt } = curve;
  requireTrade(gross > 0n && room > 0n && raised < gradAmt && sold < GANG_VIRTUAL_TOKEN && vq > 0n, 'QUOTE_UNAVAILABLE', 'The internal market has no available buying capacity.');
  const k = vq * GANG_VIRTUAL_TOKEN, q = vq + raised, t = GANG_VIRTUAL_TOKEN - sold;
  let fee = gross / 100n, net = gross - fee, refund = 0n;
  const recompute = () => { const spent = [gross, ceil(net * 10000n, 9900n)].reduce((a, b) => a < b ? a : b); fee = spent / 100n; net = spent - fee; refund = gross - spent; };
  if (net > gradAmt - raised) { net = gradAmt - raised; recompute(); if (net > gradAmt - raised) net = gradAmt - raised; }
  let output = t - ceil(k, q + net);
  if (output > room) { output = room; net = ceil(k, t - room) - q; recompute(); }
  requireTrade(output > 0n && net > 0n, 'QUOTE_UNAVAILABLE', 'This amount has no executable token output.');
  return { output, fee, refund, spent: gross - refund };
}

export function gangSell(curve, amount) {
  requireTrade(amount > 0n && amount <= curve.sold && curve.virtualQuote > 0n, 'INVALID_AMOUNT', 'The sell amount exceeds the available internal supply.');
  const gross = curve.virtualQuote + curve.realQuote - ceil(curve.virtualQuote * GANG_VIRTUAL_TOKEN, GANG_VIRTUAL_TOKEN - curve.sold + amount);
  requireTrade(gross > 0n && gross <= curve.realQuote, 'QUOTE_UNAVAILABLE', 'The internal market cannot settle this sale.');
  const fee = gross / 100n;
  return { output: gross - fee, fee };
}

export function splitSlippage(bps) {
  requireTrade(Number.isInteger(bps) && bps >= 0 && bps < 10000, 'INVALID_SLIPPAGE', 'Slippage must be between 0 and 9999 basis points.');
  return [Math.floor(bps / 2), bps - Math.floor(bps / 2)];
}
