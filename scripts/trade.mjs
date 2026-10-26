#!/usr/bin/env node
import { loadConfig, summarizeCapabilities } from './lib/config.mjs';
import { validateRepository } from './lib/validate.mjs';

// Deliberately offline: this framework has no wallet, RPC, approval or trading commands.
const root = new URL('../', import.meta.url);
const [command, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !['capabilities', 'validate'].includes(command)) {
    throw new Error('Only offline capabilities / validate commands are implemented. Usage: node scripts/trade.mjs capabilities|validate');
  }
  const data = command === 'capabilities'
    ? summarizeCapabilities(await loadConfig(root))
    : await validateRepository(root);
  process.stdout.write(`${JSON.stringify({ success: true, data }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ success: false, error: { code: 'FRAMEWORK_ONLY', message: error.message } }, null, 2)}\n`);
  process.exitCode = 1;
}
