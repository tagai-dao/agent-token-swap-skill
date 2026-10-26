#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildReadPlan, decodeReadResult, encodeTagai, tagaiRegistry } from './lib/tagai.mjs';

const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
try {
  const [command, filename, ...extra] = process.argv.slice(2);
  if (extra.length || !['deployments', 'encode', 'read-plan', 'decode-read'].includes(command)
      || (command === 'deployments' ? filename !== undefined : !filename)) {
    throw new Error('Usage: node scripts/tagai.mjs deployments | encode|read-plan|decode-read request.json. Offline only; no signing or broadcasting.');
  }
  const request = filename ? JSON.parse(await readFile(filename, 'utf8')) : null;
  const data = command === 'deployments' ? tagaiRegistry()
    : command === 'encode' ? await encodeTagai(request)
      : command === 'read-plan' ? await buildReadPlan(request)
        : await decodeReadResult(request.plan, request.result);
  process.stdout.write(`${json({ success: true, data })}\n`);
} catch (error) {
  process.stderr.write(`${json({ success: false, error: { code: 'TAGAI_PREPARATION_ERROR', message: error.message } })}\n`);
  process.exitCode = 1;
}
