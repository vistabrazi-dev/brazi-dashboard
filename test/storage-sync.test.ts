import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testStore,destroy} from './helpers/database.js';
import {pacedFetch} from '../src/integration/transport.js';
import {collect,SyncService} from '../src/integration/sync.js';
import {InkClient} from '../src/ink.js';
import {dashboardApp} from '../src/dashboard-app.js';
import type {Order} from '../src/domain/models.js';
const row:Order={id:1,day:'2026-10-01',payment:'Pago',status:'delivered',exchange:false,total:100,shipping:0,freightDifference:0,promotion:0,paymentDiscount:0,items:[{sku:'A',quantity:1,free:0,refunded:0,unit:100,total:100}],issues:[]};
test('upsert é idempotente, persiste após reabertura e mantém ausências para conciliação',async()=>{
 let store=await testStore();const schema=store.schema;
 try {
  const run=(await store.acquire())!;assert.equal(await store.acquire(),null);await store.commit(run,{orders:[row],products:[],refunds:[]},'America/Sao_Paulo');
  const next=(await store.acquire())!;await store.commit(next,{orders:[{...row,total:200}],products:[],refunds:[]},'America/Sao_Paulo');assert.equal((await store.orders()).length,1);assert.equal((await store.orders())[0]?.total,200);
  await store.close();store=await testStore(schema);assert.equal((await store.orders())[0]?.total,200);
  const missing=(await store.acquire())!;await store.commit(missing,{orders:[],products:[],refunds:[]},'America/Sao_Paulo');assert.equal((await store.orders())[0]?.missing,true);
 }finally{await destroy(store);}
});
test('falha transacional preserva snapshot e uma concessão expirada não sobrescreve dados',async()=>{
 const store=await testStore();try{
  const first=(await store.acquire())!;await store.commit(first,{orders:[row],products:[],refunds:[]},'America/Sao_Paulo');
  const second=(await store.acquire())!;await assert.rejects(()=>store.commit(second,{orders:[{...row,total:300}],products:[{id:1,name:undefined as unknown as string,variants:[],bad:1n} as never],refunds:[]},'America/Sao_Paulo'));
  assert.equal((await store.orders())[0]?.total,100);await store.db.query(`UPDATE "${store.schema}".runs SET heartbeat=0 WHERE id=$1`,[second]);
  const third=(await store.acquire())!;assert.ok(third>second);await assert.rejects(()=>store.commit(second,{orders:[{...row,total:400}],products:[],refunds:[]},'America/Sao_Paulo'));assert.equal((await store.orders())[0]?.total,100);
 }finally{await destroy(store);}
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
 const store=await testStore(),sync=new SyncService(store,undefined,'America/Sao_Paulo'),app=dashboardApp(store,sync,{timezone:'America/Sao_Paulo',tokenConfigured:false,staticRoot:'/not-existing'});
 try{
  assert.equal((await app.inject({url:'/api/sync',method:'POST',payload:{}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/sync',method:'POST',headers:{'x-brazi-request':'1',origin:'https://foreign.example'},payload:{}})).statusCode,403);
  assert.equal((await app.inject({url:'/api/sync',method:'POST',headers:{'x-brazi-request':'1'},payload:{}})).statusCode,503);
  assert.equal((await app.inject('/api/dashboard?start=2026-02-30&end=2026-03-01')).statusCode,400);
  const url='/api/dashboard?start=2026-10-01&end=2026-10-31';assert.equal((await app.inject(url)).json().current.orders,0);
  const run=(await store.acquire())!;await store.commit(run,{orders:[row],products:[],refunds:[]},'America/Sao_Paulo');
  const res=await app.inject(url);assert.equal(res.json().current.orders,1);assert.equal(res.headers['cache-control'],'no-store');assert.doesNotMatch(res.body,/RESERVA_INK_TOKEN|Authorization/);
 }finally{await app.close();await destroy(store);}
});
test('sincronização completa publica pedidos, produtos e reembolsos no PostgreSQL e preserva a carga em HTTP 401',async(t)=>{
 const store=await testStore();let denied=false;
 t.mock.method(globalThis,'fetch',async(input:URL|string)=>{
  const path=new URL(String(input)).pathname;if(denied)return new Response('{}',{status:401});
  const raw={created_at:'2026-10-01T12:00:00Z',payment_status:'Pago',order_status:'delivered',is_exchange:false,total_value:'10.00',shipping_value:'0.00',freight_value_difference:'0.00',promotion_value:'0.00',payment_discount_value:'0.00',buyer:{email:'synthetic@example.com'},items:[{sku:'A',quantity:1,unit_value:'10.00',total_value:'10.00',free_quantity:0,refunded_quantity:0}]};
  const pagination={page:1,per_page:100,total_pages:1};
  if(path.endsWith('/orders'))return new Response(JSON.stringify({...pagination,total_count:2,orders:[{...raw,id:1},{...raw,id:2,payment_status:'Reembolsado'}]}));
  if(path.endsWith('/products'))return new Response(JSON.stringify({...pagination,total_count:1,products:[{id:1,name:'Produto fictício',product_variants:[{id:1,sku:'A'}]}]}));
  if(path.endsWith('/orders/2/refunds'))return new Response(JSON.stringify({refunds:[{id:1,status:'approved',partial:false,total_refund_amount:'10.00'}]}));
  throw new Error('Endpoint inesperado no teste.');
 });
 const sync=new SyncService(store,'synthetic-token','America/Sao_Paulo',1);
 async function finish(){for(let i=0;i<200;i++){const state=await store.status();if(state.run?.status!=='running')return state;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Sincronização não terminou.');}
 try{
  assert.equal((await sync.start()).accepted,true);const success=await finish();assert.equal(success.run?.status,'success');assert.equal(success.coverage.orders,2);assert.equal(success.products,1);assert.equal((await store.refunds())[0]?.events[0]?.total,1000);assert.doesNotMatch(JSON.stringify(await store.orders()),/synthetic@example|buyer/);
  denied=true;assert.equal((await sync.start()).accepted,true);const failed=await finish();assert.equal(failed.run?.status,'failed');assert.equal(failed.version,success.version);assert.equal(failed.coverage.orders,2);
 }finally{await sync.stop();await destroy(store);}
});
