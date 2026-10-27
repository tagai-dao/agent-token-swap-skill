import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, ZeroAddress, ZeroHash, keccak256 } from 'ethers';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { abiInterface, tagaiRegistry } from '../scripts/lib/tagai.mjs';
import { FlapLive, flapRegistry, decodeFlapProof } from '../scripts/lib/flap-live.mjs';
import { PlatformLive } from '../scripts/lib/platform-live.mjs';
import { ChainReader, createRpc } from '../scripts/lib/live-rpc.mjs';
import { PlanStore, WalletExecution } from '../scripts/lib/wallet-execution.mjs';
import { gangRegistry } from '../scripts/lib/gang-live.mjs';

const token = '0x1111111111111111111111111111111111111111', wallet = '0x2222222222222222222222222222222222222222';
const market = '0x3333333333333333333333333333333333333333', pair = '0x4444444444444444444444444444444444444444';
const quoteToken = '0x5555555555555555555555555555555555555555';
const now = 1800000000, blockHash = `0x${'ab'.repeat(32)}`, txHash = `0x${'cd'.repeat(32)}`, unit = 10n ** 18n;
const config = flapRegistry(), tagai = tagaiRegistry();
const files = ['abis/flap/portal.json', 'abis/flap/agent-curve.json', 'abis/flap/tax-token.json', 'abis/erc20.json', 'abis/tagai/read-interfaces.json', 'abis/tagai/pancake.json', 'abis/imported-token-swap-wrapper.json', 'abis/gang/v2.json', 'abis/gang/soft.json', 'abis/gang/s.json'];
const ifaces = await Promise.all(files.map(abiInterface));
const portal = ifaces[0], agent = ifaces[1], erc20 = ifaces[3], wrapper = ifaces[6];
const multi = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[])']);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function empty(param) {
  if (param.baseType === 'tuple') return Object.fromEntries(param.components.map(p => [p.name, empty(p)]));
  if (param.baseType === 'array') return [];
  if (param.type === 'address') return ZeroAddress;
  if (param.type === 'bool') return false;
  if (param.type === 'string') return '';
  if (param.type.startsWith('bytes')) return param.type === 'bytes' ? '0x' : ZeroHash;
  return 0n;
}
const tuple = (method, fields) => Object.assign(empty(agent.getFunction(method).outputs[0]), fields);

function fixture(options = {}) {
  const state = { agent: false, external: false, status: 1n, cap: 0n, remaining: 1000n * unit, allowance: 0n, handle: 'holder',
    agentPhase: 1n, tax: 100n, taxState: 3n, quoteAsset: ZeroAddress, extension: ZeroHash, ...options };
  const deployment = structuredClone(config);
  deployment.portal.runtimeHash = deployment.portal.implementationRuntimeHash = deployment.wrapper.runtimeHash = keccak256('0x6000');
  for (const record of Object.values(deployment.agentCurve.identities)) {
    record.runtimeHash = keccak256('0x6000');
    if (record.implementationRuntimeHash) record.implementationRuntimeHash = keccak256('0x6000');
  }
  const A = deployment.agentCurve.identities, trace = [], walletTrace = [];
  const header = () => ({ number: '0x100', hash: blockHash, timestamp: `0x${now.toString(16)}` });
  const marketDetail = () => tuple('marketDetail', { market, quoteToken: state.quoteAsset, quoteDecimals: 18n, capRaw: 5n * unit, poolRaw: unit,
    remainingRaw: 4n * unit, progressBps: 2000n, phase: state.agentPhase, predictedToken: token, token: state.agentPhase === 3n ? token : ZeroAddress,
    pair, totalShares: 1000n * unit, maxWalletShares: 10000n * unit, agentFeeBps: 100n, quoteBalanceKnown: true, quoteBackingEnough: true });
  const marketSettings = () => {
    const settings = tuple('marketSettings', { quoteToken: state.quoteAsset, quoteDecimals: 18n, capRaw: 5n * unit, curveR: 6n * unit, curveH: 100000000n * unit, curveK: 6600000000n * unit });
    settings.launch.name = 'Curve'; settings.launch.symbol = 'CURVE'; return settings;
  };
  const position = () => tuple('userPosition', { shares: 2000n * unit, remainingWalletShares: 8000n * unit, eligibilityKnown: true, eligible: state.handle !== '' });
  const transport = async (_url, init) => {
    const request = JSON.parse(init.body); assert.equal(Array.isArray(request), false); trace.push(request);
    const { method, params } = request;
    let result;
    if (method === 'eth_chainId') result = '0x38';
    else if (method === 'eth_getBlockByNumber') result = header();
    else if (method === 'eth_getCode') result = state.changedCode && same(params[0], deployment.portal.address) ? '0x6001' : '0x6000';
    else if (method === 'eth_getStorageAt') {
      const record = [deployment.portal, ...Object.values(A)].find(x => same(x.address, params[0]));
      result = `0x${(state.upgrade ? token : record.implementation).slice(2).padStart(64, '0')}`;
    } else if (method === 'eth_estimateGas') result = '0x249f0';
    else if (method === 'eth_getBalance') result = '0x8ac7230489e80000';
    else if (method === 'eth_gasPrice') result = '0x1';
    else if (method === 'eth_call') {
      const tx = params[0];
      if (!same(tx.to, tagai.multicall)) {
        assert.equal(tx.from.toLowerCase(), wallet);
        const parsed = agent.parseTransaction({ data: tx.data });
        if (parsed?.name === 'sellBps') {
          assert.equal(parsed.args.market.toLowerCase(), market);
          result = agent.encodeFunctionResult('sellBps', [unit / 10n]);
        } else result = '0x';
      } else {
        const calls = multi.decodeFunctionData('aggregate3', tx.data)[0];
        if (state.capacity && calls.length > 3) return { ok: true, json: async () => ({ error: { code: -32000, message: 'response size limit exceeded' } }) };
        const rows = calls.map(child => {
          let abi, parsed;
          for (const candidate of ifaces) { try { const p = candidate.parseTransaction({ data: child.callData }); if (p) { parsed = p; abi = candidate; break; } } catch {} }
          if (parsed?.name === 'curves') { const pad = gangRegistry().pads.find(pad => same(pad.address, child.target)); abi = ifaces[files.indexOf(pad.abi)]; parsed = abi.parseTransaction({ data: child.callData }); }
          assert.ok(parsed, child.callData.slice(0, 10));
          const args = parsed.args, name = parsed.name;
          if (state.fail === name) return [false, '0x'];
          let output;
          switch (name) {
            case 'curves': output = abi.getFunction('curves').outputs.map(empty); break;
            case 'isMarket': output = [state.agent && same(args[0], market)]; break;
            case 'marketOfToken': output = [state.agent && same(args[0], token) ? market : ZeroAddress]; break;
            case 'createdTokens': output = [state.conflictingIssuer === true]; break;
            case 'getTokenV8Safe': case 'getTokenV9Safe': {
              if (state.agent || !same(args[0], token)) return [false, portal.encodeErrorResult('TokenNotFound', [args[0]])];
              const tuple = Object.assign(empty(portal.getFunction(name).outputs[0]), { status: state.external ? 4n : state.status,
                circulatingSupply: 1000000n * unit, dexSupplyThresh: 800000000n * unit, price: 1000000000n, progress: unit / 2n,
                quoteTokenAddress: state.quoteAsset, nativeToQuoteSwapEnabled: state.conversion === true, extensionID: state.extension,
                buyTaxRate: state.tax, sellTaxRate: state.tax, pool: state.external ? pair : ZeroAddress, tokenVersion: state.tokenVersion ?? 6n, bondingCurveFeeRate: 125n });
              output = [tuple]; break;
            }
            case 'name': case 'symbol': output = [same(child.target, token) ? 'FLAPTEST' : 'QUOTE']; break;
            case 'decimals': output = [18]; break;
            case 'getFeeRate': output = [100, 100]; break;
            case 'getQuoteTokenConfiguration': output = [{ enabled: 1, defaultCurve: 0, alternativeCurve: 0, nativeToQuoteSwapType: 6, dexId: state.conversionDex ?? 0 }]; break;
            case 'enableTaxOnBondingCurve': output = [true]; break;
            case 'balanceOf': output = [5000n * unit]; break;
            case 'maxBuyPerOrigin': output = [state.cap > 0n ? 100 : 0, state.cap]; break;
            case 'buyQuotaOf': assert.equal(args.origin.toLowerCase(), wallet); assert.equal(tx.from.toLowerCase(), wallet); output = [1n, state.remaining]; break;
            case 'quoteExactInput':
              if (state.cap > 0n) assert.equal(tx.from.toLowerCase(), wallet);
              output = [args.params.inputToken === ZeroAddress ? 1000n * unit : unit / 100n]; break;
            case 'allowance': output = [state.allowance]; break;
            case 'factory': output = [same(child.target, pair) || same(child.target, tagai.dex.v2Router) ? tagai.dex.v2Factory : A.factory.address]; break;
            case 'WETH': case 'wrappedNative': output = [tagai.wrappedNative]; break;
            case 'token0': output = [token]; break;
            case 'token1': output = [tagai.wrappedNative]; break;
            case 'getReserves': output = [1000000n * unit, 100n * unit, 0]; break;
            case 'getPair': output = [state.wrongPair ? token : pair]; break;
            case 'paused': output = [state.paused === true]; break;
            case 'nutboxRouter': output = [deployment.nutboxRouter.address]; break;
            case 'previewFees': output = [args[0] - args[0] * 40n / 10000n, args[0] * 20n / 10000n, args[0] * 20n / 10000n]; break;
            case 'previewTokenFee': output = [args[1] - args[1] * 20n / 10000n, args[1] * 20n / 10000n]; break;
            case 'state': output = [state.taxState]; break;
            case 'mainPool': output = [pair]; break;
            case 'buyTaxRate': case 'sellTaxRate': output = [state.tax]; break;
            case 'getAmountsOut': output = [Array.from([args[0], args[0] * 2n])]; break;
            case 'portal': output = [A.portal.address]; break;
            case 'phase': output = [state.agentPhase]; break;
            case 'token': output = [state.agentPhase === 3n ? token : ZeroAddress]; break;
            case 'predictedToken': output = [token]; break;
            case 'marketBeacon': output = [A.marketBeacon.address]; break;
            case 'implementation': output = [A.marketImplementation.address]; break;
            case 'marketDetail': output = [marketDetail()]; break;
            case 'marketSettings': output = [marketSettings()]; break;
            case 'userPosition': assert.equal(args.wallet.toLowerCase(), wallet); output = [position()]; break;
            case 'handleOf': output = [state.handle]; break;
            case 'quoteBuy': assert.equal(args.wallet.toLowerCase(), wallet); output = [args.grossWei, args.grossWei / 100n, 0, 1000n * unit]; break;
            case 'marketCount': output = [state.agent ? 1 : 0]; break;
            case 'marketPage': output = [[market], 1, 1]; break;
            case 'marketCards': output = [[{ ...empty(agent.getFunction(name).outputs[0].arrayChildren), market, quoteToken: state.quoteAsset, name: 'Curve', symbol: 'CURVE', predictedToken: token, phase: state.agentPhase }]]; break;
            default: throw Error(`unexpected ${name}`);
          }
          return [true, abi.encodeFunctionResult(parsed.fragment, output)];
        });
        result = multi.encodeFunctionResult('aggregate3', [rows]);
      }
    } else throw Error(`unexpected RPC ${method}`);
    return { ok: true, json: async () => ({ result }) };
  };
  const reader = new ChainReader(createRpc('https://test.invalid', transport), { multicallRuntimeHash: keccak256('0x6000'), now: () => now });
  const fetcher = async () => ({ ok: !state.searchBlocked, json: async () => state.searchRows ?? [{ coin: { address: token, symbol: 'FLAPTEST', name: 'Test' } }] });
  const live = new FlapLive({ reader, fetcher, now: () => now, deployment });
  const walletRun = async args => {
    walletTrace.push(args);
    if (args[1] === 'status') return { status: 'CONNECTED' };
    if (args[1] === 'address') return { addresses: [{ binanceChainId: '56', address: wallet }] };
    if (args[1] === 'settings') return { devMode: { enabled: true } };
    if (args[1] === 'tx-lock') return { status: 'UNLOCKED' };
    if (args[1] === 'preview') return { requestId: 'flap-preview', expiresAt: (now + 60) * 1000, parsedTx: { type: 'ContractCall' }, simulationResult: { simulationCode: '000000000' } };
    if (args[1] === 'execute') return { status: 'BROADCASTED', txHash };
    throw Error(`unexpected wallet ${args}`);
  };
  return { live, reader, trace, state, deployment, walletRun, walletTrace };
}

test('Flap normal internal quotes use token-specific fees and ABI without double subtraction', async () => {
  const f = fixture(); const q = await f.live.quote({ token, side: 'buy', amount: '0.01' });
  assert.equal(q.quoteOut, 1000n * unit); assert.equal(q.minimum, 990n * unit);
  assert.equal(q.summary.fees.protocolFeeBps, 125); assert.equal(q.summary.platform, 'Flap');
  const tx = await f.live.transaction(q, wallet); const p = portal.parseTransaction({ data: tx.inputData });
  assert.equal(tx.to, config.portal.address); assert.equal(tx.valueWei, '10000000000000000');
  assert.deepEqual(Array.from(p.args.params), [ZeroAddress, token, 10000000000000000n, 990n * unit, '0x']);
});

test('Flap quota stages preserve actual outer wallet and never substitute zero-fill quotes', async () => {
  const f = fixture({ cap: 2000n * unit });
  await assert.rejects(f.live.quote({ token, side: 'buy', amount: '0.01' }), e => e.code === 'WALLET_REQUIRED');
  const q = await f.live.quote({ token, side: 'buy', amount: '0.01', wallet });
  assert.equal(q.summary.buyingLimit.remainingTokenAmount, '1000.0');
  f.state.remaining = 0n;
  await assert.rejects(f.live.quote({ token, side: 'buy', amount: '0.01', wallet }), e => e.code === 'BUY_LIMIT_REACHED');
});

test('Flap batch target, subcalls, fixed block and caller survive chunk retries', async () => {
  const f = fixture({ cap: unit, capacity: true }); await f.live.quote({ token, side: 'buy', amount: '0.01', wallet });
  const calls = f.trace.filter(r => r.method === 'eth_call'); assert.ok(calls.length > 4);
  const methods = [];
  for (const r of calls) {
    assert.ok(same(r.params[0].to, tagai.multicall)); assert.equal(r.params[1], '0x100');
    for (const c of multi.decodeFunctionData('aggregate3', r.params[0].data)[0]) {
      let parsed;
      for (const abi of ifaces) { try { parsed = abi.parseTransaction({ data: c.callData }); } catch {} if (parsed) break; }
      assert.ok(parsed); methods.push(parsed.name);
      if (['quoteExactInput', 'buyQuotaOf'].includes(parsed.name)) { assert.ok(same(c.target, config.portal.address)); assert.equal(r.params[0].from.toLowerCase(), wallet); }
    }
  }
  for (const method of ['getTokenV8Safe', 'maxBuyPerOrigin', 'buyQuotaOf', 'quoteExactInput']) assert.ok(methods.includes(method));
});

test('unknown reverts are not negative issuance; matching TokenNotFound is', async () => {
  assert.equal(await decodeFlapProof({ ok: false, errorData: portal.encodeErrorResult('TokenNotFound', [token]) }, token), 'NO_MATCH');
  assert.equal(await decodeFlapProof({ ok: false, errorData: '0x' }, token), 'UNKNOWN');
  assert.equal(await decodeFlapProof({ ok: false, errorData: portal.encodeErrorResult('TokenNotFound', [wallet]) }, token), 'UNKNOWN');
});

test('required failures, upgrades, closed markets and unknown extension rules block trading', async () => {
  for (const options of [{ fail: 'getTokenV8Safe' }, { upgrade: true }, { changedCode: true }, { status: 5n }, { extension: `0x${'11'.repeat(32)}` }]) {
    const f = fixture(options); await assert.rejects(f.live.quote({ token, side: 'buy', amount: '0.01' }));
    assert.equal(f.trace.some(r => r.method === 'eth_call' && !same(r.params[0].to, tagai.multicall)), false);
  }
});

test('ordinary Flap sales approve only Portal and reset insufficient nonzero allowance first', async () => {
  const f = fixture({ allowance: 1n }); const q = await f.live.quote({ token, side: 'sell', amount: '1000', wallet });
  let approval = await f.live.nextApproval(q, wallet); let parsed = erc20.parseTransaction({ data: approval.transaction.inputData });
  assert.equal(parsed.args[0], config.portal.address); assert.equal(parsed.args[1], 0n);
  f.state.allowance = 0n; approval = await f.live.nextApproval(q, wallet); parsed = erc20.parseTransaction({ data: approval.transaction.inputData });
  assert.equal(parsed.args[1], 1000n * unit);
  f.state.allowance = 1000n * unit; assert.equal(await f.live.nextApproval(q, wallet), null);
});

test('ordinary non-native curves require an enabled conversion on a supported DEX', async () => {
  await assert.rejects(fixture({ quoteAsset: quoteToken }).live.quote({ token, side: 'buy', amount: '0.01' }), e => e.code === 'SETTLEMENT_ROUTE_UNAVAILABLE');
  await assert.rejects(fixture({ quoteAsset: quoteToken, conversion: true, conversionDex: 1 }).live.quote({ token, side: 'buy', amount: '0.01' }), e => e.code === 'SETTLEMENT_ROUTE_UNAVAILABLE');
  const q = await fixture({ quoteAsset: quoteToken, conversion: true }).live.quote({ token, side: 'buy', amount: '0.01' });
  assert.equal(q.summary.input.symbol, 'BNB'); assert.equal(q.summary.referencePrice.currency, 'QUOTE');
});

test('Flap V2 external trades use verified wrapper with final minimum and finite wrapper approval', async () => {
  const f = fixture({ external: true });
  const q = await f.live.quote({ token, side: 'sell', amount: '1000', wallet });
  const approval = await f.live.nextApproval(q, wallet);
  assert.equal(erc20.parseTransaction({ data: approval.transaction.inputData }).args[0], config.wrapper.address);
  const tx = await f.live.transaction(q, wallet), parsed = wrapper.parseTransaction({ data: tx.inputData });
  assert.equal(tx.to, config.wrapper.address); assert.equal(tx.valueWei, '0'); assert.equal(parsed.args.sourceType, 0n);
  assert.equal(parsed.args.minimumNativeOut, q.minimum); assert.equal(parsed.args.amountIn, 1000n * unit);
  assert.equal(q.summary.fees.tokenTaxBps, 100);
  await assert.rejects(fixture({ external: true, wrongPair: true }).live.quote({ token, side: 'buy', amount: '0.001' }), e => e.code === 'POOL_UNVERIFIED');
  await assert.rejects(fixture({ external: true, tokenVersion: 5n }).live.quote({ token, side: 'buy', amount: '0.001' }), e => e.code === 'TOKEN_ROUTE_UNAVAILABLE');
});

test('ID Agent predicted-address lookup does not require ERC20 code, decimals or balances', async () => {
  const f = fixture({ agent: true }); const info = await f.live.inspect(token);
  assert.equal(info.agentCurve, true); assert.equal(info.summary.tokenDeployed, false); assert.equal(info.summary.marketAddress.toLowerCase(), market);
  const requests = f.trace.filter(r => r.method === 'eth_call');
  for (const r of requests) for (const c of multi.decodeFunctionData('aggregate3', r.params[0].data)[0]) assert.notEqual(c.target.toLowerCase(), token);
});

test('ID Agent native buy requires ID, quotes explicit wallet and sends shares minimum to the app Portal', async () => {
  const f = fixture({ agent: true }); const q = await f.live.quote({ token: market, side: 'buy', amount: '0.01', wallet });
  const tx = await f.live.transaction(q, wallet), p = agent.parseTransaction({ data: tx.inputData });
  assert.equal(p.name, 'buy'); assert.equal(p.args.minShares, 990n * unit); assert.equal(tx.to, config.agentCurve.identities.portal.address);
  assert.equal(tx.valueWei, '10000000000000000'); assert.equal(await f.live.nextApproval(q, wallet), null);
  await assert.rejects(fixture({ agent: true, handle: '' }).live.quote({ token: market, side: 'buy', amount: '0.01', wallet }), e => e.code === 'BUYER_INELIGIBLE');
});

test('ID Agent percentage sale uses real-caller full simulation, protects final preview and needs no ID or approval', async () => {
  const f = fixture({ agent: true, handle: '' }); const q = await f.live.quote({ token: market, side: 'sell', amount: '50%', wallet });
  assert.equal(q.amountIn, 1000n * unit); assert.equal(q.quoteOut, unit / 10n);
  const tx = await f.live.transaction(q, wallet), p = agent.parseTransaction({ data: tx.inputData });
  assert.equal(p.name, 'sellBps'); assert.equal(p.args.bps, 5000n); assert.equal(p.args.minOut, 99000000000000000n); assert.equal(tx.valueWei, '0');
  assert.equal(await f.live.nextApproval(q, wallet), null);
  const simulation = f.trace.filter(r => r.method === 'eth_call' && !same(r.params[0].to, tagai.multicall));
  assert.equal(simulation.length, 1); assert.equal(simulation[0].params[0].from.toLowerCase(), wallet); assert.equal(simulation[0].params[1], '0x100');
  for (const r of f.trace.filter(r => r.method === 'eth_call' && same(r.params[0].to, tagai.multicall))) {
    for (const c of multi.decodeFunctionData('aggregate3', r.params[0].data)[0]) {
      const p = agent.parseTransaction({ data: c.callData }); assert.notEqual(p?.name?.endsWith('Probe'), true);
    }
  }
});

test('ID Agent closed phases and ERC20 markets do not become DEX trades or BNB-valued calls', async () => {
  await assert.rejects(fixture({ agent: true, agentPhase: 3n }).live.quote({ token: market, side: 'sell', amount: '100%', wallet }), e => e.code === 'MARKET_CLOSED');
  await assert.rejects(fixture({ agent: true, quoteAsset: quoteToken }).live.quote({ token: market, side: 'buy', amount: '0.01', wallet }), e => e.code === 'SETTLEMENT_ROUTE_UNAVAILABLE');
  await assert.rejects(fixture({ agent: true }).live.quote({ token: market, side: 'sell', amount: '1000', wallet }), e => e.code === 'SHARE_PERCENTAGE_REQUIRED');
});

test('ID Agent ticker lookup remains chain-native when ordinary HTTP search is blocked', async () => {
  const f = fixture({ agent: true, searchBlocked: true }); const rows = await f.live.search('CURVE');
  assert.equal(rows.length, 1); assert.equal(rows[0].contractAddress.toLowerCase(), market);
  assert.equal(rows[0].assetKind, 'pre-launch shares');
});

test('shared dispatcher probes both Flap market families and TagAI in the same snapshot; conflicts stop', async () => {
  const f = fixture({ agent: true }); const live = new PlatformLive({ reader: f.reader }); live.adapters.flap = f.live;
  const info = await live.inspect(market); assert.equal(info.agentCurve, true);
  const first = f.trace.find(r => r.method === 'eth_call'); const calls = multi.decodeFunctionData('aggregate3', first.params[0].data)[0];
  assert.equal(first.params[1], '0x100'); assert.ok(calls.some(c => same(c.target, config.portal.address)));
  assert.ok(calls.filter(c => same(c.target, config.agentCurve.identities.factory.address)).length === 2);
  for (const release of tagai.versions.filter(v => v.issuanceGetterDocumented && v.marketFamily !== 'import')) assert.ok(calls.some(c => same(c.target, release.pump)));
  f.state.conflictingIssuer = true; await assert.rejects(live.inspect(market), e => e.code === 'ISSUER_AMBIGUOUS');
});

test('wallet previews final protected Agent sale, never the provisional quote call, then executes once', async () => {
  const f = fixture({ agent: true }); const directory = await mkdtemp(path.join(tmpdir(), 'flap-wallet-'));
  try {
    const execution = new WalletExecution({ live: f.live, wallet: f.walletRun, store: new PlanStore(directory), now: () => now * 1000 });
    const preview = await execution.prepare({ token: market, side: 'sell', amount: '50%' });
    const command = f.walletTrace.find(args => args[1] === 'preview'); const data = command[command.indexOf('--inputData') + 1];
    assert.equal(agent.parseTransaction({ data }).args.minOut, 99000000000000000n);
    assert.equal(f.walletTrace.some(args => args[1] === 'execute'), false);
    await execution.execute(preview.planId, { confirmed: true });
    assert.deepEqual(f.walletTrace.find(args => args[1] === 'execute'), ['contract-call', 'execute', '--requestId', 'flap-preview']);
    await assert.rejects(execution.execute(preview.planId, { confirmed: true }), e => e.code === 'EXECUTION_ALREADY_STARTED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
