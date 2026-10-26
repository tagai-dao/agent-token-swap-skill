import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { formatUnits, getAddress } from 'ethers';
import { TagaiLive } from './tagai-live.mjs';
import { TradeError, requireTrade } from './live-rpc.mjs';
import { abiInterface } from './tagai.mjs';

const exec = promisify(execFile);
const stringify = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const expiryMs = value => {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const timestamp = Number(value);
    return timestamp > 100000000000 ? timestamp : timestamp * 1000;
  }
  return Date.parse(value);
};

export async function runWallet(args) {
  let output;
  try { output = await exec('baw', [...args, '--json'], { timeout: 45000, maxBuffer: 2 * 1024 * 1024 }); }
  catch (error) {
    if (error.code === 'ENOENT') throw new TradeError('WALLET_CLI_MISSING', 'Install Binance Agentic Wallet CLI to preview and send trades.');
    // A nonzero exit may still contain the structured wallet error.
    output = { stdout: error.stdout || '' };
  }
  let result;
  try { result = JSON.parse(output.stdout); } catch { throw new TradeError('WALLET_RESPONSE_UNKNOWN', 'The wallet response could not be confirmed. Check its status before retrying.'); }
  if (!result.success) throw new TradeError('WALLET_ERROR', result.error?.message || 'The wallet rejected the request.', { walletCode: result.error?.code });
  return result.data;
}

export class PlanStore {
  constructor(directory = fileURLToPath(new URL('../../.state/', import.meta.url))) { this.directory = directory; }
  file(id) {
    requireTrade(/^[0-9a-f-]{36}$/.test(id), 'INVALID_PLAN', 'The transaction preview identifier is invalid.');
    return path.join(this.directory, `${id}.json`);
  }
  async save(plan) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.file(plan.id), temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, stringify(plan), { mode: 0o600 });
    await rename(temporary, target);
  }
  async load(id) {
    try { return JSON.parse(await readFile(this.file(id), 'utf8')); }
    catch (error) { if (error instanceof TradeError) throw error; throw new TradeError('PLAN_NOT_FOUND', 'This transaction preview was not found. Prepare a new preview.'); }
  }
  async lock(id) {
    const name = `${this.file(id)}.lock`;
    let handle;
    try { handle = await open(name, 'wx', 0o600); }
    catch (error) { throw new TradeError(error.code === 'ENOENT' ? 'PLAN_NOT_FOUND' : 'PLAN_BUSY', error.code === 'ENOENT' ? 'This transaction preview was not found.' : 'This transaction is already being processed. Check its status.'); }
    return async () => { await handle.close(); await unlink(name); };
  }
}

const fingerprint = plan => createHash('sha256').update(stringify({ wallet: plan.wallet, intent: plan.intent, transaction: plan.transaction, requestId: plan.preview.requestId, expiresAt: plan.expiresAt, kind: plan.kind, summary: plan.summary, snapshot: plan.snapshot })).digest('hex');

function previewRisks(data) {
  return { parsedTransaction: data.parsedTx ?? null, risks: data.risks ?? null,
    authorityChanges: data.authorityChanges ?? data.simulationResult?.authorityChanges ?? [] };
}

export class WalletExecution {
  constructor({ live = new TagaiLive(), wallet = runWallet, store = new PlanStore(), now = () => Date.now() } = {}) {
    this.live = live; this.wallet = wallet; this.store = store; this.now = now;
  }

  async ownedWallet({ requireDeveloperMode = true, requireUnlocked = true } = {}) {
    const status = await this.wallet(['wallet', 'status']);
    requireTrade(status?.status === 'CONNECTED', 'WALLET_NOT_CONNECTED', 'Connect Binance Agentic Wallet before preparing a trade.');
    const addresses = await this.wallet(['wallet', 'address']);
    const bsc = addresses?.addresses?.find(item => String(item.binanceChainId) === '56');
    requireTrade(bsc?.address, 'WALLET_CHAIN_UNAVAILABLE', 'The wallet has no BNB Smart Chain address.');
    if (requireDeveloperMode) {
      const settings = await this.wallet(['wallet', 'settings']);
      requireTrade(settings?.devMode?.enabled === true, 'DEVELOPER_MODE_REQUIRED', 'Enable Developer Mode in Binance App to preview this contract trade.');
    }
    if (requireUnlocked) {
      const lock = await this.wallet(['wallet', 'tx-lock', '--binanceChainId', '56']);
      requireTrade(lock?.status === 'UNLOCKED', 'WALLET_LOCKED', 'A wallet transaction is pending. Resolve it before preparing another trade.');
    }
    return getAddress(bsc.address);
  }

  async prepare(intent) {
    const wallet = await this.ownedWallet();
    if (intent.wallet) requireTrade(same(intent.wallet, wallet), 'WALLET_CHANGED', 'The selected wallet differs from the connected Binance wallet.');
    const quote = await this.live.quote({ ...intent, wallet });
    const approval = await this.live.nextApproval(quote, wallet);
    const transaction = approval?.transaction ?? await this.live.transaction(quote, wallet);
    const kind = approval ? 'APPROVAL' : 'SWAP';
    await this.live.reader.verifySnapshot(quote.info.snapshot);
    await this.live.reader.simulate(quote.info.snapshot, transaction);
    let gas, balance, gasPrice;
    try {
      gas = BigInt(await this.live.reader.rpc('eth_estimateGas', [{ from: wallet, to: transaction.to, value: `0x${BigInt(transaction.valueWei).toString(16)}`, data: transaction.inputData }, quote.info.snapshot.blockTag]));
      balance = BigInt(await this.live.reader.rpc('eth_getBalance', [wallet, quote.info.snapshot.blockTag]));
      gasPrice = BigInt(await this.live.reader.rpc('eth_gasPrice', []));
    } catch (error) { throw new TradeError('GAS_ESTIMATE_FAILED', 'The network fee could not be estimated. No trade was prepared.', error.details); }
    const gasReserve = gas * gasPrice * 120n / 100n;
    requireTrade(balance >= BigInt(transaction.valueWei) + gasReserve, 'INSUFFICIENT_GAS', 'The wallet needs more BNB for this amount and its network fee.');
    const preview = await this.wallet(['contract-call', 'preview', '--binanceChainId', '56', '--from', wallet, '--to', transaction.to, '--value', transaction.valueWei, '--inputData', transaction.inputData]);
    requireTrade(typeof preview?.requestId === 'string' && preview.requestId.length > 0, 'PREVIEW_FAILED', 'The wallet did not create a valid transaction preview.');
    if (preview.simulationResult?.simulationCode !== undefined) requireTrade(String(preview.simulationResult.simulationCode) === '000000000', 'PREVIEW_FAILED', 'The wallet transaction simulation did not pass.');
    const quoteExpires = Date.parse(quote.summary.expiresAt);
    const walletExpires = preview.expiresAt === undefined ? quoteExpires : expiryMs(preview.expiresAt);
    const expiresAt = Math.min(quoteExpires, walletExpires);
    requireTrade(Number.isFinite(expiresAt) && expiresAt > this.now(), 'PREVIEW_EXPIRED', 'The quote expired during preview. Refresh it before confirming.');
    const plan = {
      id: randomUUID(), status: 'PREVIEWED', kind, createdAt: this.now(), expiresAt, wallet,
      intent: { token: quote.info.token, side: intent.side, amount: intent.amount, slippageBps: quote.slippageBps, ...(intent.subject ? { subject: intent.subject } : {}), ...(intent.recipient ? { recipient: intent.recipient } : {}) },
      summary: { ...quote.summary, estimatedNetworkFeeBnb: formatUnits(gas * gasPrice, 18), wallet, recipient: quote.recipient ?? wallet, step: approval ? 'Token approval required before the swap' : 'Trade', approval: approval?.scope ?? null },
      transaction, preview: { requestId: preview.requestId, requiresAppConfirmation: preview.requireConfirmation === true, ...previewRisks(preview) },
      snapshot: quote.info.snapshot, tokenAbi: quote.info.release.tokenAbi, decimals: quote.info.decimals,
    };
    plan.fingerprint = fingerprint(plan);
    await this.store.save(plan);
    return { planId: plan.id, status: plan.status, expiresAt: new Date(expiresAt).toISOString(), summary: plan.summary, walletPreview: previewRisks(preview), confirmationRequired: true };
  }

  async execute(id, { confirmed = false } = {}) {
    requireTrade(confirmed === true, 'CONFIRMATION_REQUIRED', 'Explicit confirmation of this transaction preview is required before sending.');
    const release = await this.store.lock(id);
    try {
      const plan = await this.store.load(id);
      requireTrade(plan.status === 'PREVIEWED', 'EXECUTION_ALREADY_STARTED', 'This preview was already processed. Check its transaction status instead of sending again.');
      requireTrade(plan.fingerprint === fingerprint(plan), 'PREVIEW_CHANGED', 'The transaction preview changed. Prepare a new preview.');
      requireTrade(plan.expiresAt > this.now(), 'PREVIEW_EXPIRED', 'This transaction preview expired. Refresh it before confirming.');
      const wallet = await this.ownedWallet();
      requireTrade(same(wallet, plan.wallet), 'WALLET_CHANGED', 'The connected wallet changed. Prepare a new preview.');
      await this.live.reader.verifySnapshot(plan.snapshot);
      const current = await this.live.reader.snapshot();
      await this.live.reader.simulate(current, plan.transaction);
      requireTrade(plan.expiresAt > this.now(), 'PREVIEW_EXPIRED', 'This transaction preview expired during the final checks. Refresh it before confirming.');
      plan.status = 'EXECUTING';
      await this.store.save(plan); // Persist before the only potentially broadcasting operation.
      let result;
      try { result = await this.wallet(['contract-call', 'execute', '--requestId', plan.preview.requestId]); }
      catch (error) {
        plan.status = 'UNKNOWN';
        plan.lastError = { code: error.code || 'WALLET_RESPONSE_UNKNOWN' };
        await this.store.save(plan);
        throw new TradeError('EXECUTION_UNKNOWN', `The submission result is unresolved. Wallet response: ${error.message} Check transaction history before retrying.`);
      }
      plan.walletOrderId = result.orderId ?? null;
      plan.txHash = result.txHash ?? null;
      plan.status = result.status === 'PENDING_CONFIRMATION' ? 'AWAITING_APP' : result.status === 'BROADCASTED' && plan.txHash ? 'SUBMITTED' : 'UNKNOWN';
      await this.store.save(plan);
      return this.publicStatus(plan);
    } finally { await release(); }
  }

  publicStatus(plan) {
    return { planId: plan.id, status: plan.status, step: plan.kind === 'APPROVAL' ? 'approval' : 'trade',
      transactionHash: plan.txHash ?? null, transactionUrl: plan.txHash ? `https://bscscan.com/tx/${plan.txHash}` : null,
      message: plan.status === 'AWAITING_APP' ? 'Approve the pending transaction in Binance App.'
        : plan.status === 'SUBMITTED' ? 'The transaction was submitted and is awaiting chain confirmation.'
          : plan.status === 'CONFIRMED' && plan.kind === 'APPROVAL' ? 'Approval confirmed. Prepare the trade again to refresh its quote and preview.'
            : plan.status === 'CONFIRMED' ? 'The transaction is confirmed.'
              : plan.status === 'FAILED' ? 'The transaction failed on chain.'
              : ['UNKNOWN', 'EXECUTING'].includes(plan.status) ? 'Submission status is unresolved. Check wallet history; do not resend.' : 'Transaction preview is available.',
      actualOutput: plan.actualOutput ?? null, continueIntent: plan.status === 'CONFIRMED' && plan.kind === 'APPROVAL' ? plan.intent : null };
  }

  async status(id) {
    const plan = await this.store.load(id);
    if (!plan.txHash && ['UNKNOWN', 'AWAITING_APP', 'EXECUTING'].includes(plan.status)) {
      const history = await this.wallet(['wallet', 'tx-history', '--binanceChainId', '56', '--type', 'all', '--size', '100', '--startTime', String(plan.createdAt)]);
      const matching = plan.walletOrderId ? history?.transactions?.find(item => String(item.orderId ?? item.id ?? '') === String(plan.walletOrderId)) : null;
      if (matching?.txHash && /^0x[0-9a-f]{64}$/i.test(matching.txHash)) { plan.txHash = matching.txHash; plan.status = 'SUBMITTED'; }
      else {
        // Some wallet history versions omit orderId. Match the complete chain
        // transaction, never just a ticker, amount, timestamp or latest hash.
        const hashes = [...new Set((history?.transactions ?? []).flatMap(item => [item.txHash, ...(item.txHashList ?? []).filter(tx => String(tx.binanceChainId) === '56').map(tx => tx.txHash)]).filter(candidate => /^0x[0-9a-f]{64}$/i.test(candidate)))].slice(0, 20);
        const exact = [];
        for (const candidate of hashes) {
          const tx = await this.live.reader.rpc('eth_getTransactionByHash', [candidate]);
          if (tx && same(tx.from, plan.wallet) && same(tx.to, plan.transaction.to)
              && BigInt(tx.value) === BigInt(plan.transaction.valueWei)
              && same(tx.input ?? tx.data, plan.transaction.inputData)
              && (tx.blockNumber === null || BigInt(tx.blockNumber) >= BigInt(plan.snapshot.blockTag))) exact.push(candidate);
        }
        if (exact.length === 1) { plan.txHash = exact[0]; plan.status = 'SUBMITTED'; }
      }
    }
    if (plan.txHash && !['CONFIRMED', 'FAILED'].includes(plan.status)) {
      const receipt = await this.live.reader.rpc('eth_getTransactionReceipt', [plan.txHash]);
      if (receipt) {
        const canonical = await this.live.reader.rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
        requireTrade(canonical?.hash === receipt.blockHash, 'RECEIPT_REORG', 'The transaction confirmation changed. Check its status again.');
        const head = BigInt(await this.live.reader.rpc('eth_blockNumber', []));
        if (head >= BigInt(receipt.blockNumber) + 1n) {
          plan.status = BigInt(receipt.status) === 1n ? 'CONFIRMED' : 'FAILED';
          plan.receiptBlock = receipt.blockNumber;
          if (plan.status === 'CONFIRMED' && plan.kind === 'SWAP') await this.captureActualOutput(plan, receipt);
        }
      }
    }
    await this.store.save(plan);
    return this.publicStatus(plan);
  }

  async captureActualOutput(plan, receipt) {
    const erc20 = await abiInterface('abis/erc20.json');
    if (plan.intent.side === 'buy') {
      let amount = 0n;
      for (const log of receipt.logs || []) {
        if (!same(log.address, plan.intent.token)) continue;
        try {
          const event = erc20.parseLog(log);
          if (event.name === 'Transfer' && same(event.args.to, plan.summary.recipient)) amount += event.args.value;
          if (event.name === 'Transfer' && same(event.args.from, plan.summary.recipient)) amount -= event.args.value;
        } catch { /* Unrelated or undecodable events are not delivery evidence. */ }
      }
      if (amount > 0n) plan.actualOutput = { amount: formatUnits(amount, plan.decimals), symbol: plan.summary.expectedOutput.symbol };
    } else if (plan.summary.market === 'internal') {
      const abi = await abiInterface(plan.tokenAbi);
      for (const log of receipt.logs || []) {
        if (!same(log.address, plan.intent.token)) continue;
        try {
          const event = abi.parseLog(log);
          if (event.name === 'Trade' && !event.args.isBuy && same(event.args.buyer, plan.wallet)) {
            const gross = event.args.ethAmount;
            const fee1 = event.args.tiptagFee ?? event.args.tipTagFee;
            const fee2 = event.args.sellsmanFee;
            if (gross !== undefined && fee1 !== undefined && fee2 !== undefined) plan.actualOutput = { amount: formatUnits(gross - fee1 - fee2, 18), symbol: 'BNB' };
          }
        } catch { /* Never substitute a quote for an unverified actual output. */ }
      }
    }
  }
}
