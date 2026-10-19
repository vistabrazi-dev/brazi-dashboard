import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {testStore,destroy} from './helpers/database.js';
import {dashboardApp} from '../src/dashboard-app.js';
import {SyncService} from '../src/integration/sync.js';
import {passwordHash} from '../src/auth/password.js';
import {orders,products,histories,order} from './fixtures/product-orders.js';
const period='start=2026-10-01&end=2026-10-03';
test('E1 lê snapshot PostgreSQL sem chamar INK, compartilha cache e invalida por versão',async t=>{
 const store=await testStore();let reads=0,calls=0;const read=store.readDashboard.bind(store);store.readDashboard=async(...args)=>{reads++;return read(...args);};
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Nenhuma chamada externa permitida.');});
 const app=dashboardApp(store,new SyncService(store,undefined,'America/Sao_Paulo'),{timezone:'America/Sao_Paulo',currency:'BRL',tokenConfigured:false,staticRoot:'/missing'});
 try{
  const run=(await store.acquire())!;await store.commit(run,{orders,products,refunds:histories},'America/Sao_Paulo');
  const res=await app.inject('/api/intelligence/products?'+period+'&sort=quantity&pageSize=2');assert.equal(res.statusCode,200);assert.equal(res.headers['cache-control'],'no-store');const body=res.json();assert.equal(body.rows.length,2);assert.equal(body.pagination.total,4);assert.equal(body.snapshotVersion,run);assert.equal(body.currency,'BRL');
  const pairs=await app.inject('/api/intelligence/baskets?'+period);assert.equal(pairs.statusCode,200);assert.equal(pairs.json().rows[0].orders,3);assert.equal(pairs.json().analysis.denominatorOrders,body.coverage.confirmedOrders);
  const evolution=await app.inject('/api/intelligence/products/1?'+period+'&granularity=month');assert.equal(evolution.statusCode,200);assert.equal(evolution.json().points.length,1);assert.equal(reads,1);assert.equal(calls,0);
  const old=body.coverage.confirmedOrders,next=(await store.acquire())!;await store.commit(next,{orders:[...orders,order(99)],products,refunds:histories},'America/Sao_Paulo');
  const updated=(await app.inject('/api/intelligence/products?'+period)).json();assert.equal(updated.snapshotVersion,next);assert.equal(updated.coverage.confirmedOrders,old+1);assert.equal(reads,2);
  const final=(await app.inject('/api/dashboard?'+period)).json();assert.equal(final.current.units,updated.coverage.totalUnits);assert.equal(final.current.merchandiseCents,updated.coverage.totalRevenueCents);assert.equal(calls,0);
 }finally{await app.close();await destroy(store);}
});
test('E1 valida filtros/paginação, vazio e erros sem informações pessoais ou SQL',async()=>{
 const store=await testStore(),app=dashboardApp(store,new SyncService(store,undefined,'America/Sao_Paulo'),{timezone:'America/Sao_Paulo',tokenConfigured:false,staticRoot:'/missing'});
 try{
  const empty=(await app.inject('/api/intelligence/products?'+period)).json();assert.equal(empty.rows.length,0);assert.equal(empty.coverage.unitCoveragePct,null);assert.equal(empty.pagination.total,0);
  for(const path of ['/api/intelligence/products?start=2026-02-30&end=2026-03-01','/api/intelligence/products?'+period+'&sort=customer','/api/intelligence/products?'+period+'&pageSize=9999','/api/intelligence/products?'+period+'&search='+('x'.repeat(121)),'/api/intelligence/products?'+period+'&unknown=1','/api/intelligence/baskets?'+period+'&productKey=-1','/api/intelligence/products/NaN?'+period,'/api/intelligence/products/1?'+period+'&granularity=year'])assert.equal((await app.inject(path)).statusCode,400,path);
  assert.equal((await app.inject('/api/intelligence/products/999?'+period)).statusCode,404);
  store.readDashboard=async()=>{throw new Error('private-person@example.com PostgreSQL secret-value');};
  const failed=await app.inject('/api/intelligence/products?start=2026-10-02&end=2026-10-03');assert.equal(failed.statusCode,500);assert.doesNotMatch(failed.body,/private-person|PostgreSQL|secret-value/);
 }finally{await app.close();await destroy(store);}
});
test('endpoints E1 exigem sessão, não expõem dados anônimos e respeitam logout',async()=>{
 const store=await testStore(),password=randomBytes(24).toString('hex'),origin='https://test.example',headers={'x-forwarded-proto':'https',origin,'x-brazi-request':'1'};
 let reads=0;const read=store.readDashboard.bind(store);store.readDashboard=async(...args)=>{reads++;return read(...args);};
 const app=dashboardApp(store,new SyncService(store,undefined,'America/Sao_Paulo'),{timezone:'America/Sao_Paulo',tokenConfigured:false,staticRoot:'/missing',auth:{enabled:true,production:true,username:'test-user',passwordHash:await passwordHash(password),origin}});
 try{
  const paths=['/api/intelligence/products?'+period,'/api/intelligence/baskets?'+period,'/api/intelligence/products/1?'+period];
  for(const url of paths){const res=await app.inject({url,headers});assert.equal(res.statusCode,401);assert.doesNotMatch(res.body,/coverage|sourceOrders|rows|customer/);assert.equal(res.headers['cache-control'],'no-store');}
  assert.equal(reads,0);const login=await app.inject({url:'/api/auth/login',method:'POST',headers,payload:{username:'test-user',password}});assert.equal(login.statusCode,200);const cookie=String(login.headers['set-cookie']).split(';')[0]!;
  assert.equal((await app.inject({url:paths[0]!,headers:{...headers,cookie}})).statusCode,200);
  const logout=await app.inject({url:'/api/auth/logout',method:'POST',headers:{...headers,cookie},payload:{}});assert.equal(logout.statusCode,200);
  assert.equal((await app.inject({url:paths[0]!,headers:{...headers,cookie}})).statusCode,401);
 }finally{await app.close();await destroy(store);}
});
test('consultas simultâneas compartilham carga e excesso recebe 503 sem abrir trabalho ilimitado',async()=>{
 const store=await testStore(),read=store.readDashboard.bind(store),releases:(()=>void)[]=[];let reads=0;
 store.readDashboard=async(...args)=>{reads++;await new Promise<void>(resolve=>releases.push(resolve));return read(...args);};
 const app=dashboardApp(store,new SyncService(store,undefined,'America/Sao_Paulo'),{timezone:'America/Sao_Paulo',tokenConfigured:false,staticRoot:'/missing'});
 const waitFor=async(n:number)=>{for(let i=0;i<100&&reads<n;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(reads,n);};
 try{
  const a=app.inject('/api/intelligence/products?'+period);void a.then(()=>{});await waitFor(1);
  const same=app.inject('/api/intelligence/baskets?'+period);void same.then(()=>{});
  const b=app.inject('/api/intelligence/products?start=2026-10-02&end=2026-10-03');void b.then(()=>{});await waitFor(2);
  const excess=await app.inject('/api/intelligence/products?start=2026-10-03&end=2026-10-03');assert.equal(excess.statusCode,503);assert.equal(excess.headers['retry-after'],'3');assert.equal(reads,2);
  releases.splice(0).forEach(release=>release());const responses=await Promise.all([a,same,b]);assert.ok(responses.every(res=>res.statusCode===200));assert.equal(reads,2);
 }finally{releases.splice(0).forEach(release=>release());await app.close();await destroy(store);}
});
test('cache E1 retém no máximo quatro períodos agregados',async()=>{
 const store=await testStore();let reads=0;const read=store.readDashboard.bind(store);store.readDashboard=async(...args)=>{reads++;return read(...args);};
 const app=dashboardApp(store,new SyncService(store,undefined,'America/Sao_Paulo'),{timezone:'America/Sao_Paulo',tokenConfigured:false,staticRoot:'/missing'});
 try{
  for(let day=1;day<=5;day++){const response=await app.inject(`/api/intelligence/products?start=2026-10-01&end=2026-10-0${day}`);assert.equal(response.statusCode,200);}assert.equal(reads,5);
  await app.inject('/api/intelligence/products?start=2026-10-01&end=2026-10-05');assert.equal(reads,5);
  await app.inject('/api/intelligence/products?start=2026-10-01&end=2026-10-01');assert.equal(reads,6);
 }finally{await app.close();await destroy(store);}
});
