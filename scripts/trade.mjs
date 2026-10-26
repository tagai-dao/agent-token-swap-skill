#!/usr/bin/env node
import { loadConfig, summarizeCapabilities } from './lib/config.mjs';
import { validateRepository } from './lib/validate.mjs';
import { TagaiLive } from './lib/tagai-live.mjs';
import { WalletExecution } from './lib/wallet-execution.mjs';
import { TradeError } from './lib/live-rpc.mjs';

const root = new URL('../', import.meta.url);
const print = data => process.stdout.write(`${JSON.stringify({ success: true, data }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)}\n`);
const allowed = new Set(['capabilities', 'validate', 'info', 'quote', 'prepare', 'execute', 'status']);
try {
  const [command, ...args] = process.argv.slice(2);
  if (!allowed.has(command)) throw new TradeError('INVALID_COMMAND', 'Use capabilities, validate, info, quote, prepare, execute, or status.');
  const options = {};
  const flags = new Set(['token', 'side', 'amount', 'wallet', 'slippage-bps', 'recipient', 'subject', 'plan', 'confirmed']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !flags.has(key) || Object.hasOwn(options, key)) throw new TradeError('INVALID_ARGUMENT', 'Use documented command options only.');
    if (key === 'confirmed') options[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new TradeError('INVALID_ARGUMENT', `A value is required for --${key}.`);
      options[key] = args[++i];
    }
  }
  const permitted = {
    capabilities: [], validate: [], info: ['token'], quote: ['token', 'side', 'amount', 'wallet', 'slippage-bps', 'subject', 'recipient'],
    prepare: ['token', 'side', 'amount', 'wallet', 'slippage-bps', 'subject', 'recipient'], execute: ['plan', 'confirmed'], status: ['plan'],
  };
  if (Object.keys(options).some(key => !permitted[command].includes(key))) throw new TradeError('INVALID_ARGUMENT', 'An option is not valid for this command.');
  if (command === 'capabilities') print(summarizeCapabilities(await loadConfig(root)));
  else if (command === 'validate') print(await validateRepository(root));
  else {
    await loadConfig(root);
    const live = new TagaiLive();
    const execution = new WalletExecution({ live });
    if (command === 'info') {
      if (!options.token) throw new TradeError('TOKEN_REQUIRED', 'Provide a token ticker or contract address with --token.');
      print((await live.inspect(options.token)).summary);
    } else if (command === 'quote' || command === 'prepare') {
      if (!options.token || !options.side || !options.amount) throw new TradeError('INTENT_REQUIRED', 'Provide --token, --side buy|sell, and --amount.');
      const intent = { token: options.token, side: options.side, amount: options.amount,
        slippageBps: options['slippage-bps'] === undefined ? 100 : Number(options['slippage-bps']),
        ...(options.wallet ? { wallet: options.wallet } : {}), ...(options.subject ? { subject: options.subject } : {}), ...(options.recipient ? { recipient: options.recipient } : {}) };
      if (command === 'prepare') print(await execution.prepare(intent));
      else {
        if (intent.amount.endsWith('%') && !intent.wallet) intent.wallet = await execution.ownedWallet({ requireDeveloperMode: false, requireUnlocked: false });
        print((await live.quote(intent)).summary);
      }
    } else {
      if (!options.plan) throw new TradeError('PLAN_REQUIRED', 'Provide the transaction preview identifier with --plan.');
      print(command === 'execute' ? await execution.execute(options.plan, { confirmed: options.confirmed === true }) : await execution.status(options.plan));
    }
  }
} catch (error) {
  const data = { success: false, error: { code: error.code || 'TRADE_UNAVAILABLE', message: error instanceof TradeError ? error.message : 'The request could not be completed. Check the token, amount, and connection.' } };
  if (error.code === 'TOKEN_AMBIGUOUS') data.error.candidates = error.details.candidates;
  process.stderr.write(`${JSON.stringify(data, null, 2)}\n`);
  process.exitCode = 1;
}
