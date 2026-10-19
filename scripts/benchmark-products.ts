// Somente dados sintéticos e PostgreSQL de teste LOCAL; não usa DATABASE_URL comercial.
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {dashboard} from '../src/domain/metrics.js';
import {productIntelligence} from '../src/domain/product-intelligence.js';
import {dashboardApp} from '../src/dashboard-app.js';
import {SyncService} from '../src/integration/sync.js';
import {testStore,destroy} from '../test/helpers/database.js';
import type {Order,Product} from '../src/domain/models.js';
const catalog:Product[]=Array.from({length:120},(_,i)=>({id:i+1,name:`Produto fictício ${i+1}`,variants:[{id:i+1,sku:`SYNTH-${i+1}`}]}));
const results=[];
for(const size of [5000,20000,50000]){
 const rows:Order[]=Array.from({length:size},(_,i)=>{
  const items=Array.from({length:4},(_,j)=>{const id=1+(i+j*13)%120;return {sku:i%10===0&&j===3?'UNKNOWN':`SYNTH-${id}`,quantity:1,free:0,refunded:0,unit:7900,total:7900};});
  return {id:i+1,day:`2026-10-${String(1+i%28).padStart(2,'0')}`,payment:'Pago',status:'delivered',exchange:false,total:31900,shipping:1200,freightDifference:200,promotion:500,paymentDiscount:200,items,issues:[]};
 });
 const baseline=dashboard(rows,catalog,[],'2026-10-01','2026-10-31');let elapsed:number[]=[];
 for(let run=0;run<5;run++){const before=performance.now(),data=productIntelligence(rows,catalog,[],'2026-10-01','2026-10-31');elapsed.push(performance.now()-before);assert.equal(data.coverage.totalRevenueCents,baseline.current.merchandiseCents);assert.equal(data.coverage.totalUnits,baseline.current.units);assert.deepEqual(data.ranking,baseline.ranking);}
 const store=await testStore(),app=dashboardApp(store,new SyncService(store,undefined,'America/Sao_Paulo'),{timezone:'America/Sao_Paulo',tokenConfigured:false,staticRoot:'/missing'});
 try{
  await store.commit((await store.acquire())!,{orders:rows,products:catalog,refunds:[]},'America/Sao_Paulo');
  const path='/api/intelligence/products?start=2026-10-01&end=2026-10-31';let before=performance.now();const first=await app.inject(path);const firstMs=performance.now()-before;assert.equal(first.statusCode,200);
  const cached=[];for(let n=0;n<10;n++){before=performance.now();const response=await app.inject(path);cached.push(performance.now()-before);assert.equal(response.statusCode,200);}
  const target=[];for(let n=0;n<5;n++){before=performance.now();const response=await app.inject('/api/intelligence/baskets?start=2026-10-01&end=2026-10-31&productKey=1');target.push(performance.now()-before);assert.equal(response.statusCode,200);assert.equal(response.json().analysis.scope,'product');}target.sort((a,b)=>a-b);
  elapsed.sort((a,b)=>a-b);cached.sort((a,b)=>a-b);results.push({orders:size,items:size*4,aggregationP95Ms:Math.round(elapsed[4]!),firstHttpMs:Math.round(firstMs),cachedHttpP95Ms:Math.round(cached[9]!),selectedBasketP95Ms:Math.round(target[4]!),responseBytes:Buffer.byteLength(first.body),processPeakRssMiB:Math.round(process.resourceUsage().maxRSS/1024),candidateProducts:first.json().basketAnalysis.candidateProducts,pairOccurrencesCoveredPct:Number(first.json().basketAnalysis.pairOccurrenceCoveragePct.toFixed(1))});
 }finally{await app.close();await destroy(store);}
 if(typeof globalThis.gc==='function')globalThis.gc();
}
console.log(JSON.stringify({environment:'PostgreSQL local, dados sintéticos, sem deploy',aggregationSamples:5,cachedHttpSamples:10,results},null,2));
