import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, ZeroAddress, AbiCoder, parseUnits } from 'ethers';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GangLive, gangRegistry } from '../scripts/lib/gang-live.mjs';
import { gangBuy, gangSell, GANG_VIRTUAL_TOKEN, splitSlippage } from '../scripts/lib/gang-math.mjs';
import { ChainReader, createRpc, TradeError } from '../scripts/lib/live-rpc.mjs';
import { abiInterface, tagaiRegistry } from '../scripts/lib/tagai.mjs';
import { flapRegistry } from '../scripts/lib/flap-live.mjs';
import { WalletExecution, PlanStore } from '../scripts/lib/wallet-execution.mjs';

const R = gangRegistry(), T = tagaiRegistry(), unit = 10n ** 18n;
const token = '0x1111111111111111111111111111111111111111', wallet = '0x2222222222222222222222222222222222222222';
const pair = '0x3333333333333333333333333333333333333333', bridge = '0x4444444444444444444444444444444444444444';
const now = 1800000000, blockHash = `0x${'ab'.repeat(32)}`;
const files = ['abis/gang/v2.json','abis/gang/soft.json','abis/gang/s.json','abis/gang/dex.json','abis/gang/wbnb.json','abis/erc20.json','abis/tagai/pancake.json','abis/imported-token-swap-wrapper.json','abis/multicall3.json'];
const interfaces = Object.fromEntries(await Promise.all(files.map(async file => [file, await abiInterface(file)])));
const multi = interfaces['abis/multicall3.json'], erc20 = interfaces['abis/erc20.json'];
const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
const zero = field => field.type === 'address' ? ZeroAddress : field.type === 'bool' ? false : 0n;

function fixture(options = {}) {
  const state = { external:false, taxed:false, bridgeRoute:false, cap:10000000n*unit, allowance:0n, noAgent:false, receipts:new Map(), ...options };
  const config=structuredClone(R), wrapper=flapRegistry();
  for(const pad of config.pads) pad.runtimeHash=keccak256('0x6000');
  wrapper.wrapper.runtimeHash=wrapper.nutboxRouter.runtimeHash=keccak256('0x6000');
  const trace=[],walletTrace=[]; let sent=0,previews=0;
  const curve=()=>{const vq=10000n*unit, realQuote=state.expensive?15000n*unit:2000n*unit;return {vq,realQuote,sold:GANG_VIRTUAL_TOKEN-(vq*GANG_VIRTUAL_TOKEN+vq+realQuote-1n)/(vq+realQuote)};};
  const rpc=createRpc('https://fixture.invalid',async(_url,init)=>{
    const request=JSON.parse(init.body); assert.equal(Array.isArray(request),false);trace.push(request);
    const {method,params}=request;let result;
    if(method==='eth_chainId')result='0x38';
    else if(method==='eth_getBlockByNumber')result={number:'0x100',hash:blockHash,timestamp:'0x'+now.toString(16)};
    else if(method==='eth_getCode')result='0x6000';
    else if(method==='eth_estimateGas')result='0x249f0';
    else if(method==='eth_getBalance')result='0xde0b6b3a7640000';
    else if(method==='eth_gasPrice')result='0x1';
    else if(method==='eth_blockNumber')result='0x102';
    else if(method==='eth_getTransactionReceipt')result=state.receipts.get(params[0])??null;
    else if(method==='eth_call'){
      assert.equal(params[1],'0x100');
      if(!same(params[0].to,T.multicall)){assert.equal(params[0].from,wallet);result='0x';}
      else{
        const calls=multi.decodeFunctionData('aggregate3',params[0].data)[0];
        if(state.capacity&&calls.length>3)return{ok:true,json:async()=>({error:{code:-32000,message:'response size limit exceeded'}})};
        const results=calls.map(child=>{
          let abi,parsed;const pad=config.pads.find(p=>same(p.address,child.target));
          if(pad){abi=interfaces[pad.abi];parsed=abi.parseTransaction({data:child.callData});}
          if(!parsed)for(const candidate of Object.values(interfaces)){const p=candidate.parseTransaction({data:child.callData});if(p){abi=candidate;parsed=p;break;}}
          assert.ok(parsed,child.callData.slice(0,10));
          const a=parsed.args;let out;
          if(state.fail===parsed.name)return[false,'0x'];
          switch(parsed.name){
            case'curves':{
              const isTarget=same(a[0],token)&&pad.id===(state.padId??'v2'),isGang=same(a[0],R.platformToken)&&pad.id==='main';
              if(!isTarget&&!isGang)out=abi.getFunction('curves').outputs.map(zero);
              else if(isGang)out=[wallet,0,800000000n*unit,true,bridge];
              else if(pad.kind==='native')out=[wallet,unit,100000000n*unit,state.external,pair];
              else{const c=curve();out=[wallet,state.wbnb?T.wrappedNative:state.unknownQuote?'0x5555555555555555555555555555555555555555':R.platformToken,c.realQuote,c.sold,30000n*unit,c.vq,state.external,state.taxed,state.external?pair:ZeroAddress,bridge];if(pad.id==='s')out.splice(7,1);}break;
            }
            case'name':case'symbol':out=[same(child.target,R.platformToken)?'GANG':'TEST'];break;
            case'decimals':out=[18];break;
            case'launchpad':out=[same(child.target,R.platformToken)?config.pads.find(p=>p.id==='main').address:config.pads.find(p=>p.id===(state.padId??'v2')).address];break;
            case'locked':out=[same(child.target,token)&&!state.external];break;
            case'MAX_PER_WALLET':out=[state.cap];break;
            case'GRADUATION_BNB':out=[20n*unit];break;
            case'spotPrice':out=[1000000000n];break;
            case'balanceOf':out=[same(child.target,token)?5000n*unit:1000000n*unit];break;
            case'walletRoom':assert.ok(same(a[1],wallet)||same(a[1],ZeroAddress));out=[state.cap];break;
            case'isAgent':assert.equal(a[0],wallet);out=[!state.noAgent];break;
            case'factory':out=[T.dex.v2Factory];break;
            case'WETH':case'wrappedNative':out=[T.wrappedNative];break;
            case'token0':out=[same(child.target,bridge)?R.platformToken:token];break;
            case'token1':out=[same(child.target,bridge)?T.wrappedNative:R.platformToken];break;
            case'getReserves':out=[1000000n*unit,1000n*unit,0];break;
            case'getPair':out=[same(a[0],R.platformToken)||same(a[1],T.wrappedNative)?bridge:pair];break;
            case'paused':out=[false];break;
            case'nutboxRouter':out=[wrapper.nutboxRouter.address];break;
            case'hasRoute':out=[state.bridgeRoute];break;
            case'routePoolCount':out=[state.bridgeRoute?1:0];break;
            case'routePoolAt':out=['0x'+'12'.repeat(32)];break;
            case'pricePool':out=[true,1,R.platformToken,T.wrappedNative,0,AbiCoder.defaultAbiCoder().encode(['tuple(address,address)'],[[T.dex.v2Router,bridge]])];break;
            case'previewFees':out=[a[0]-a[0]*40n/10000n,a[0]*20n/10000n,a[0]*20n/10000n];break;
            case'previewTokenFee':out=[a[1],0];break;
            case'getAmountsOut':{let amount=a[0];const values=[amount];for(let i=1;i<a[1].length;i++){amount=amount*1000n;values.push(amount);}out=[values];break;}
            case'pair':out=[pair];break;
            case'taxHandler':out=['0x6666666666666666666666666666666666666666'];break;
            case'OUTER_TAX_BPS':out=[100];break;
            case'isExcluded':out=[false];break;
            case'allowance':out=[state.allowance];break;
            case'quoteBuy':out=[a[2]*1000n,a[2]*99n/100n,a[2]/100n,0];break;
            case'quoteSell':out=[a[1]/1000n,a[1]/100000n];break;
            default:throw Error('Unhandled '+parsed.name);
          }
          return[true,abi.encodeFunctionResult(parsed.fragment,out)];
        });result=multi.encodeFunctionResult('aggregate3',[results]);
      }
    }else throw Error('Unexpected '+method);
    return{ok:true,json:async()=>({result})};
  });
  const reader=new ChainReader(rpc,{now:()=>now,multicallRuntimeHash:keccak256('0x6000')});
  const gang=new GangLive({reader,now:()=>now,deployment:config,wrapperDeployment:wrapper});
  const live={reader,adapters:{gang},quote:intent=>gang.quote(intent),transaction:(q,w)=>gang.transaction(q,w),nextApproval:(q,w)=>gang.nextApproval(q,w),captureActualOutput:(p,r)=>gang.captureActualOutput(p,r)};
  const walletRun=async args=>{walletTrace.push(args);if(args[0]==='wallet'){
    if(args[1]==='status')return{status:'CONNECTED'};
    if(args[1]==='address')return{addresses:[{binanceChainId:'56',address:wallet}]};
    if(args[1]==='settings')return{devMode:{enabled:true}};
    if(args[1]==='tx-lock')return{status:'UNLOCKED'};
    if(args[1]==='tx-history')return{transactions:[]};
  }if(args[1]==='preview')return{requestId:'p'+(++previews),expiresAt:(now+60)*1000,simulationResult:{simulationCode:'000000000'}};
    if(args[1]==='execute'){if(state.unknown)throw new TradeError('WALLET_RESPONSE_UNKNOWN','timeout');return{orderId:'o'+sent,status:'BROADCASTED',txHash:'0x'+(++sent).toString(16).padStart(64,'0')};}throw Error(args.join(' '));};
  const receipt=(hash,asset,amount,from=bridge)=>{const event=erc20.encodeEventLog('Transfer',[from,wallet,amount]);state.receipts.set(hash,{status:'0x1',blockNumber:'0x100',blockHash,logs:[{address:asset,...event}]});};
  return{gang,live,reader,state,trace,walletRun,walletTrace,receipt};
}

const intent={token,side:'buy',amount:'0.001',wallet};

test('GANG token state proves every pad, preserves the settlement currency and uses pinned Multicall chunks only',async()=>{
  const f=fixture({capacity:true});const info=await f.gang.inspect(token);
  assert.equal(info.summary.platform,'GANG');assert.equal(info.summary.referencePrice.currency,'GANG');
  for(const request of f.trace.filter(r=>r.method==='eth_call')){assert.equal(request.params[0].to,T.multicall);assert.equal(request.params[1],'0x100');}
  const children=f.trace.filter(r=>r.method==='eth_call').flatMap(r=>Array.from(multi.decodeFunctionData('aggregate3',r.params[0].data)[0]));
  for(const pad of R.pads){const probes=children.filter(c=>same(c.target,pad.address)&&interfaces[pad.abi].parseTransaction({data:c.callData})?.name==='curves');assert.ok(probes.length);for(const child of probes)assert.equal(interfaces[pad.abi].parseTransaction({data:child.callData}).args[0],token);}
});

test('GANG buys quote BNB to new GANG before the direct nonpayable pad buy with compounded route protection',async()=>{
  const f=fixture(),q=await f.gang.quote(intent);assert.equal(q.routeSteps.length,2);
  const[first,second]=q.routeSteps;assert.equal(first.step.kind,'wrapper');assert.equal(second.step.kind,'pad');assert.equal(second.amountIn,first.quoteOut);
  assert.equal(first.slippageBps+second.slippageBps,100);
  const final=await f.gang.transaction(second,wallet),parsed=interfaces['abis/gang/v2.json'].parseTransaction({data:final.inputData});
  assert.equal(final.valueWei,'0');assert.equal(final.to,R.pads[0].address);assert.equal(parsed.args.quoteIn,first.quoteOut);
  assert.ok(q.minimum<=second.minimum);assert.equal(q.summary.minimumOutput.symbol,'TEST');
});

test('GANG gate, required-read failure, unsupported settlement and unknown input stop before previews',async()=>{
  for(const[options,code]of[[{noAgent:true},'BUYER_INELIGIBLE'],[{fail:'curves'},'INCOMPLETE_STATE'],[{unknownQuote:true},'SETTLEMENT_ROUTE_UNAVAILABLE']])await assert.rejects(fixture(options).gang.quote(intent),e=>e.code===code);
});

test('GANG external routes prefer wrapper; missing configured bridge selects verified direct Pancake path, including tax',async()=>{
  for(const bridgeRoute of[false,true]){const f=fixture({external:true,taxed:true,bridgeRoute}),q=await f.gang.quote(intent);
    assert.equal(q.step.kind,bridgeRoute?'wrapper':'direct');
    const transaction=await f.gang.transaction(q,wallet);assert.equal(transaction.to,bridgeRoute?flapRegistry().wrapper.address:T.dex.v2Router);
    assert.equal(transaction.valueWei,'1000000000000000');assert.ok(q.quoteOut>0n);
    if(!bridgeRoute){assert.match(q.step.fallback,/no route/);assert.deepEqual(q.step.path,[T.wrappedNative,R.platformToken,token]);}
  }
});

test('V2 integer quotes respect wallet/refund and graduation caps and the route slippage budget',()=>{
  const c={virtualQuote:5n*unit,realQuote:0n,sold:0n,gradAmt:15n*unit};
  const buy=gangBuy(c,unit,100n*unit);assert.equal(buy.output,100n*unit);assert.ok(buy.refund>0n);assert.equal(buy.spent+buy.refund,unit);
  const fill=gangBuy(c,100n*unit,2n**255n);assert.ok(fill.refund>0n);assert.ok(fill.output<=800000001n*unit);
  const sale=gangSell({...c,realQuote:unit,sold:gangBuy(c,unit,2n**255n).output},100n*unit);assert.ok(sale.output>0n);
  for(const bps of[0,1,100,9999]){const[a,b]=splitSlippage(bps);assert.equal(a+b,bps);assert.ok(BigInt(10000-a)*BigInt(10000-b)>=BigInt(10000-bps)*10000n);}
});

async function execution(run,options={}){const f=fixture(options),directory=await mkdtemp(path.join(tmpdir(),'gang-route-'));try{const e=new WalletExecution({live:f.live,wallet:f.walletRun,store:new PlanStore(directory),now:()=>now*1000});await run({...f,e});}finally{await rm(directory,{recursive:true,force:true});}}

test('route execution persists actual new GANG, finite approval and exact previews; existing GANG is never added',async()=>execution(async f=>{
  const p=await f.e.prepare(intent),id=p.planId;
  const sent=await f.e.execute(id,{confirmed:true});const amount=parseUnits(p.summary.expectedOutput.amount,18);
  f.receipt(sent.transactionHash,R.platformToken,amount);
  const approval=await f.e.resume(id);assert.equal(approval.summary.step,'Token approval required before the swap');
  const child=await f.e.store.load(approval.stepPlanId),parsed=erc20.parseTransaction({data:child.transaction.inputData});assert.equal(parsed.args[1],amount);
  assert.ok(amount<1000000n*unit);
  const approveSent=await f.e.execute(id,{confirmed:true});f.state.receipts.set(approveSent.transactionHash,{status:'0x1',blockNumber:'0x100',blockHash,logs:[]});f.state.allowance=amount;
  const trade=await f.e.resume(id),tradePlan=await f.e.store.load(trade.stepPlanId);
  assert.equal(interfaces['abis/gang/v2.json'].parseTransaction({data:tradePlan.transaction.inputData}).args.quoteIn,amount);
  const done=await f.e.execute(id,{confirmed:true}),output=parseUnits(trade.summary.expectedOutput.amount,18);f.receipt(done.transactionHash,token,output,R.pads[0].address);
  assert.equal((await f.e.status(id)).status,'COMPLETED');assert.equal((await f.e.resume(id)).status,'COMPLETED');
  await assert.rejects(f.e.execute(id,{confirmed:true}));assert.equal(f.walletTrace.filter(c=>c[1]==='execute').length,3);
}));

test('a worse second-step quote leaves a resumable partial route without repeating its completed first swap',async()=>execution(async f=>{
  const p=await f.e.prepare(intent),sent=await f.e.execute(p.planId,{confirmed:true});f.receipt(sent.transactionHash,R.platformToken,parseUnits(p.summary.expectedOutput.amount,18));
  f.state.expensive=true;await assert.rejects(f.e.resume(p.planId),e=>e.code==='ROUTE_PRICE_CHANGED');
  const status=await f.e.status(p.planId);assert.equal(status.status,'PARTIAL');assert.equal(status.currentStep,2);assert.ok(BigInt(status.intermediateAmountRaw)>0n);
  f.state.expensive=false;await f.e.resume(p.planId);assert.equal(f.walletTrace.filter(c=>c[1]==='execute').length,1);
}));

test('unknown submission and missing receipt output cannot spend an existing intermediate balance',async()=>execution(async f=>{
  const p=await f.e.prepare(intent);f.state.unknown=true;await assert.rejects(f.e.execute(p.planId,{confirmed:true}),e=>e.code==='EXECUTION_UNKNOWN');
  await assert.rejects(f.e.resume(p.planId),e=>e.code==='ROUTE_STEP_PENDING');await assert.rejects(f.e.execute(p.planId,{confirmed:true}));
  assert.equal(f.walletTrace.filter(c=>c[1]==='execute').length,1);
}));

test('confirmed receipt without actual GANG delivery stops continuation; edited route state is rejected',async()=>execution(async f=>{
  const p=await f.e.prepare(intent),sent=await f.e.execute(p.planId,{confirmed:true});f.state.receipts.set(sent.transactionHash,{status:'0x1',blockNumber:'0x100',blockHash,logs:[]});
  await assert.rejects(f.e.resume(p.planId),e=>e.code==='DELIVERY_UNVERIFIED');
  const route=await f.e.store.load(p.planId);route.nextAmountRaw=(1000000n*unit).toString();await f.e.store.save(route);
  await assert.rejects(f.e.resume(p.planId),e=>e.code==='INVALID_PLAN');
}));

test('WBNB settlement uses deposit/withdraw and receipt events, without consuming old wrapped balances',async()=>{
  const f=fixture({wbnb:true}),q=await f.gang.quote(intent),first=q.routeSteps[0];assert.equal(first.step.kind,'wrap');
  const transaction=await f.gang.transaction(first,wallet);assert.equal(transaction.valueWei,'1000000000000000');
  const abi=interfaces['abis/gang/wbnb.json'],event=abi.encodeEventLog('Deposit',[wallet,1000000000000000n]);
  const result=await f.gang.captureActualOutput({step:first.step,transaction,intent:{token:T.wrappedNative,side:'buy'},wallet,decimals:18,summary:{expectedOutput:{symbol:'WBNB'}}},{logs:[{address:T.wrappedNative,...event}]});
  assert.equal(result.amount,'0.001');assert.equal(result.assetAddress,T.wrappedNative);
});

test('native archived markets use their own payable buy, sale quote and finite pad approval',async()=>{
  const f=fixture({padId:'main'}),buy=await f.gang.quote(intent),transaction=await f.gang.transaction(buy,wallet);
  assert.equal(buy.routeSteps,undefined);assert.equal(transaction.valueWei,'1000000000000000');assert.equal(transaction.to,R.pads.find(p=>p.id==='main').address);
  assert.equal(interfaces['abis/gang/soft.json'].parseTransaction({data:transaction.inputData}).signature,'buy(address,uint256)');
  const sell=await f.gang.quote({...intent,side:'sell',amount:'1000'});assert.equal(sell.summary.expectedOutput.symbol,'BNB');
  const approval=await f.gang.nextApproval(sell,wallet);assert.equal(erc20.parseTransaction({data:approval.transaction.inputData}).args[0],transaction.to);
});

test('GANG sale continuation converts only the pad receipt output and verifies final wrapper native delivery',async()=>execution(async f=>{
  const p=await f.e.prepare({...intent,side:'sell',amount:'1000'});let sent=await f.e.execute(p.planId,{confirmed:true});
  f.state.receipts.set(sent.transactionHash,{status:'0x1',blockNumber:'0x100',blockHash,logs:[]});f.state.allowance=1000n*unit;
  const sale=await f.e.resume(p.planId);sent=await f.e.execute(p.planId,{confirmed:true});const received=parseUnits(sale.summary.expectedOutput.amount,18);f.receipt(sent.transactionHash,R.platformToken,received,R.pads[0].address);f.state.allowance=0n;
  const approval=await f.e.resume(p.planId),child=await f.e.store.load(approval.stepPlanId);assert.equal(erc20.parseTransaction({data:child.transaction.inputData}).args[1],received);
  sent=await f.e.execute(p.planId,{confirmed:true});f.state.receipts.set(sent.transactionHash,{status:'0x1',blockNumber:'0x100',blockHash,logs:[]});f.state.allowance=received;
  const trade=await f.e.resume(p.planId),plan=await f.e.store.load(trade.stepPlanId);const abi=interfaces['abis/imported-token-swap-wrapper.json'],parsed=abi.parseTransaction({data:plan.transaction.inputData});assert.equal(parsed.args.amountIn,received);
  sent=await f.e.execute(p.planId,{confirmed:true});const out=parseUnits(trade.summary.expectedOutput.amount,18);
  const event=abi.encodeEventLog('ImportedTokenTrade',[wallet,R.platformToken,ZeroAddress,false,T.wrappedNative,0,keccak256(parsed.args.sourceData),received,out,out,0,0,0,wallet]);
  f.state.receipts.set(sent.transactionHash,{status:'0x1',blockNumber:'0x100',blockHash,logs:[{address:flapRegistry().wrapper.address,...event}]});
  const status=await f.e.status(p.planId);assert.equal(status.status,'COMPLETED');assert.equal(status.actualOutput.symbol,'BNB');assert.equal(status.actualOutput.amount,trade.summary.expectedOutput.amount);
}));

test('a failed second swap resumes with saved GANG and a new preview without repeating the first swap',async()=>execution(async f=>{
  const p=await f.e.prepare(intent),first=await f.e.execute(p.planId,{confirmed:true});
  const received=parseUnits(p.summary.expectedOutput.amount,18);f.receipt(first.transactionHash,R.platformToken,received);f.state.allowance=received;
  const second=await f.e.resume(p.planId),sent=await f.e.execute(p.planId,{confirmed:true});
  f.state.receipts.set(sent.transactionHash,{status:'0x0',blockNumber:'0x100',blockHash,logs:[]});
  assert.equal((await f.e.status(p.planId)).routeStatus,'PARTIAL');
  const retry=await f.e.resume(p.planId);assert.equal(retry.currentStep,2);assert.notEqual(retry.stepPlanId,second.stepPlanId);
  const child=await f.e.store.load(retry.stepPlanId);assert.equal(interfaces['abis/gang/v2.json'].parseTransaction({data:child.transaction.inputData}).args.quoteIn,received);
  const root=await f.e.store.load(p.planId);assert.equal(root.completedSteps.length,1);assert.equal(root.completedSteps[0].transactionHash,first.transactionHash);
  assert.equal(f.walletTrace.filter(c=>c[1]==='execute').length,2);
}));

test('GANG eligibility applies to internal sales too, and insufficient nonzero allowances reset before finite approval',async()=>{
  await assert.rejects(fixture({noAgent:true}).gang.quote({...intent,side:'sell',amount:'1000'}),e=>e.code==='BUYER_INELIGIBLE');
  const f=fixture({allowance:1n}),q=await f.gang.quote(intent),step=q.routeSteps[1];
  const reset=await f.gang.nextApproval(step,wallet);assert.equal(erc20.parseTransaction({data:reset.transaction.inputData}).args[1],0n);
});


test('legacy U/S queries decode their own curve layouts and never reuse V2 internal execution',async()=>{
  for(const padId of ['u','s']){const f=fixture({padId}),info=await f.gang.inspect(token);assert.equal(info.phase,'internal');assert.equal(info.quoteAsset.address,R.platformToken);assert.equal(info.curve.taxed,padId==='s');await assert.rejects(f.gang.quote(intent),e=>e.code==='TOKEN_ROUTE_UNAVAILABLE');}
});
