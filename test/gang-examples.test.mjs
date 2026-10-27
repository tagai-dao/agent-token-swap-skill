import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { abiInterface } from '../scripts/lib/tagai.mjs';
import { normalizeTokenInput } from '../scripts/lib/token-input.mjs';
import { gangBuy, gangSell } from '../scripts/lib/gang-math.mjs';

const cases=JSON.parse(await readFile(new URL('../config/gang-worked-examples.json',import.meta.url),'utf8'));
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();

test('GANG token links retain the exact selected contract and reject alternate hosts or routes',()=>{
  const t='0x0059a88c12c49fF30dD1637d6d0C695eD52010c9';
  assert.equal(normalizeTokenInput(`https://gang.fun/token/${t}?source=test`),t);
  assert.equal(normalizeTokenInput(t),t);
  for(const link of [`https://gang.fun.evil/token/${t}`,`https://gang.fun@evil/token/${t}`,`http://gang.fun/token/${t}`,`https://gang.fun/profile/${t}`])assert.throws(()=>normalizeTokenInput(link));
});

test('all eight captured GANG cases decode to the exact documented ABI parameters and value semantics',async()=>{
  assert.equal(cases.examples.length,8);assert.equal(cases.transactionBroadcast,false);assert.equal(cases.walletConnected,false);
  for(const c of cases.examples){
    assert.match(c.snapshot.blockTag,/^0x[0-9a-f]+$/);assert.match(c.snapshot.blockHash,/^0x[0-9a-f]{64}$/);
    for(const s of c.steps){const abi=await abiInterface(s.abi),p=abi.parseTransaction({data:s.transaction.inputData,value:BigInt(s.transaction.valueWei)});
      assert.equal(p.signature,s.decoded.signature);assert.equal(abi.encodeFunctionData(p.fragment,s.decoded.args),s.transaction.inputData);
      assert.ok(BigInt(s.quoteOutRaw)>=BigInt(s.minimumOutRaw));
      if(s.step.kind==='pad')assert.ok(same(p.args[0],c.token));
      if(p.fragment.stateMutability!=='payable')assert.equal(s.transaction.valueWei,'0');
    }
  }
  assert.equal(cases.examples.flatMap(c=>c.steps).filter(s=>s.simulation).length,4);
});

test('captured internal GANG quotes reproduce source integer math and the compounded whole-route minimum',()=>{
  for(const side of['buy','sell']){
    const c=cases.examples.find(c=>c.id===`internal-${side}`),curve=Object.fromEntries(Object.entries(c.curve).map(([k,v])=>[k,/^\d+$/.test(String(v))?BigInt(v):v]));
    const pad=c.steps.find(s=>s.step.kind==='pad');
    const result=side==='buy'?gangBuy(curve,BigInt(pad.amountInRaw),10000000n*10n**18n):gangSell(curve,BigInt(pad.amountInRaw));
    assert.equal(result.output.toString(),pad.quoteOutRaw);
    assert.equal(result.output*9950n/10000n,BigInt(pad.minimumOutRaw));
    if(side==='buy')assert.equal(gangBuy(curve,BigInt(c.steps[0].minimumOutRaw),10000000n*10n**18n).output*9950n/10000n,BigInt(c.minimumOutRaw));
  }
});
