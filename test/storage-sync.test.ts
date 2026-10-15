import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/storage/store.js';
import {pacedFetch} from '../src/integration/transport.js';
import {collect,SyncService} from '../src/integration/sync.js';
import {InkClient} from '../src/ink.js';
import {dashboardApp} from '../src/dashboard-app.js';
import type {Order} from '../src/domain/models.js';
const row:Order={id:1,day:'2026-10-01',payment:'Pago',status:'delivered',exchange:false,total:100,shipping:0,freightDifference:0,promotion:0,paymentDiscount:0,items:[{sku:'A',quantity:1,free:0,refunded:0,unit:100,total:100}],issues:[]};
test('upsert é idempotente, persiste após reabertura e mantém ausências para conciliação',()=>{
 const dir=mkdtempSync(join(tmpdir(),'brazi-test-')),file=join(dir,'data.sqlite');let store=new Store(file);
 try {
  const run=store.acquire()!;assert.equal(store.acquire(),null);store.commit(run,{orders:[row],products:[],refunds:[]},'America/Sao_Paulo');
  const next=store.acquire()!;store.commit(next,{orders:[{...row,total:200}],products:[],refunds:[]},'America/Sao_Paulo');assert.equal(store.orders().length,1);assert.equal(store.orders()[0]?.total,200);
  store.close();store=new Store(file);assert.equal(store.orders()[0]?.total,200);
  const missing=store.acquire()!;store.commit(missing,{orders:[],products:[],refunds:[]},'America/Sao_Paulo');assert.equal(store.orders()[0]?.missing,true);
 }finally{store.close();rmSync(dir,{recursive:true});}
});
test('falha transacional preserva snapshot e uma concessão expirada não sobrescreve dados',()=>{
 const store=new Store(':memory:');try{
  const first=store.acquire()!;store.commit(first,{orders:[row],products:[],refunds:[]},'America/Sao_Paulo');
  const second=store.acquire()!;assert.throws(()=>store.commit(second,{orders:[{...row,total:300}],products:[{id:1,name:undefined as unknown as string,variants:[],bad:1n} as never],refunds:[]},'America/Sao_Paulo'));
  assert.equal(store.orders()[0]?.total,100);store.db.prepare('UPDATE runs SET heartbeat=0 WHERE id=?').run(second);
  const third=store.acquire()!;assert.ok(third>second);assert.throws(()=>store.commit(second,{orders:[{...row,total:400}],products:[],refunds:[]},'America/Sao_Paulo'));assert.equal(store.orders()[0]?.total,100);
 }finally{store.close();}
});
test('429 respeita Retry-After, renova timeout e não repassa redirecionamentos',async()=>{
 const waits:number[]=[];let calls=0;const signals:AbortSignal[]=[];
 const transport=pacedFetch({pauseMs:1,wait:async ms=>{waits.push(ms);},fetcher:(async(_url,init)=>{calls++;signals.push(init!.signal!);assert.equal(init?.redirect,'error');return calls===1?new Response('',{status:429,headers:{'retry-after':'90'}}):new Response('{}');}) as typeof fetch});
 assert.equal((await transport('https://api.reserva.ink')).status,200);assert.deepEqual(waits,[1,90000,1]);assert.notEqual(signals[0],signals[1]);
});
test('retries são limitados, falhas de autorização não são repetidas e cancelamento funciona',async()=>{
 let calls=0;const transport=pacedFetch({wait:async()=>{},fetcher:(async()=>{calls++;return new Response('',{status:503});}) as typeof fetch});await assert.rejects(transport('https://api.reserva.ink'));assert.equal(calls,6);
 calls=0;const auth=pacedFetch({wait:async()=>{},fetcher:(async()=>{calls++;return new Response('',{status:401});}) as typeof fetch});assert.equal((await auth('https://api.reserva.ink')).status,401);assert.equal(calls,1);
 const control=new AbortController();control.abort();await assert.rejects(pacedFetch({signal:control.signal})('https://api.reserva.ink'));
});
test('paginação integral detecta mudança de totais e preserva o erro',async()=>{
 const client=new InkClient('fake',(async url=>{const page=Number(new URL(String(url)).searchParams.get('page'));return new Response(JSON.stringify({orders:[{id:page}],page,per_page:100,total_pages:2,total_count:page===1?2:3}));}) as typeof fetch);
 await assert.rejects(collect(client,'orders',r=>r,()=>{}),/mudou/);
});
test('API do dashboard protege sincronização, valida filtros e invalida cache após commit',async()=>{
 const store=new Store(':memory:'),sync=new SyncService(store,undefined,'America/Sao_Paulo'),app=dashboardApp(store,sync,{timezone:'America/Sao_Paulo',tokenConfigured:false,staticRoot:'/not-existing'});
 try{
  assert.equal((await app.inject({url:'/api/sync',method:'POST',payload:{}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/sync',method:'POST',headers:{'x-brazi-request':'1',origin:'https://foreign.example'},payload:{}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/sync',method:'POST',headers:{'x-brazi-request':'1'},payload:{}})).statusCode,503);
  assert.equal((await app.inject('/api/dashboard?start=2026-02-30&end=2026-03-01')).statusCode,400);
  const url='/api/dashboard?start=2026-10-01&end=2026-10-31';assert.equal((await app.inject(url)).json().current.orders,0);
  const run=store.acquire()!;store.commit(run,{orders:[row],products:[],refunds:[]},'America/Sao_Paulo');
  const res=await app.inject(url);assert.equal(res.json().current.orders,1);assert.equal(res.headers['cache-control'],'no-store');assert.doesNotMatch(res.body,/RESERVA_INK_TOKEN|Authorization/);
 }finally{await app.close();store.close();}
});
