import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {testStore,testUrl,destroy} from './helpers/database.js';
import {Store} from '../src/storage/store.js';
import {StartupFailure} from '../src/startup-diagnostics.js';
import {connectionOptions} from '../src/storage/connection.js';
import {dashboard} from '../src/domain/metrics.js';
import type {Snapshot,Order} from '../src/domain/models.js';
const order:Order={id:1,day:'2026-10-01',payment:'Pago',status:'delivered',exchange:false,total:10001,shipping:100,freightDifference:1,promotion:97,paymentDiscount:2,items:[{sku:'A',sourceProductId:1,quantity:1,free:0,refunded:0,unit:10000,total:10000}],issues:[]};
test('TLS remoto e produção verificam certificado; URL não pode sobrescrever opções de segurança',()=>{
 const remote=connectionOptions('postgresql://user:synthetic-pass@db.example/brazi?sslmode=require',{production:true});assert.deepEqual(remote.ssl,{rejectUnauthorized:true});assert.equal(remote.max,3);assert.equal(remote.connectionString,undefined);assert.equal(remote.port,5432);
 assert.deepEqual(connectionOptions('postgresql://user:synthetic-pass@db.example/brazi',{ca:'test-ca'}).ssl,{rejectUnauthorized:true,ca:'test-ca'});
 assert.equal(connectionOptions('postgresql://user@127.0.0.1/brazi?sslmode=disable').ssl,false);
 for(const url of ['http://db.example/brazi','postgresql://user:synthetic-pass@db.example/brazi?sslmode=disable','postgresql://user:synthetic-pass@db.example/brazi?sslmode=no-verify','postgresql://user:synthetic-pass@db.example/brazi?sslcert=ignored','postgresql://user:synthetic-pass@db.example/brazi?options=unsafe'])assert.throws(()=>connectionOptions(url));
 assert.throws(()=>connectionOptions('postgresql://user@127.0.0.1/brazi?sslmode=disable',{production:true}));
});
test('migrações idempotentes concorrentes, schema privado e RLS nos dados e sessões',async()=>{
 const schema='test_'+randomBytes(10).toString('hex');
 const [store,second]=await Promise.all([Store.open(testUrl(),{schema}),Store.open(testUrl(),{schema})]);
 try{
  const versions=await store.db.query(`SELECT version FROM "${store.schema}".schema_migrations`);assert.deepEqual(versions.rows,[{version:1}]);
  const tables=await store.db.query('SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind=$2',[store.schema,'r']);assert.equal(tables.rowCount,8);assert.ok(tables.rows.every(r=>r.relrowsecurity));
  const publicAccess=await store.db.query('SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a WHERE n.nspname=$1 AND a.grantee=0',[schema]);assert.equal(publicAccess.rowCount,0);
  for(const role of ['anon','authenticated'])if((await store.db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)assert.equal((await store.db.query('SELECT has_schema_privilege($1,$2,$3) AS allowed',[role,schema,'USAGE'])).rows[0].allowed,false);
  await store.db.query(`INSERT INTO "${store.schema}".schema_migrations(version) VALUES(999)`);
  await assert.rejects(Store.open(testUrl(),{schema:store.schema}),error=>error instanceof StartupFailure&&error.stage==='database-migrations'&&(error.cause as {code?:string})?.code==='BRAZI_DB_VERSION');
 }finally{await second.close();await destroy(store);}
});
test('concessão e limite de login são atômicos entre pools concorrentes',async()=>{
 const a=await testStore(),b=await Store.open(testUrl(),{schema:a.schema});
 try{
  const runs=await Promise.all(Array.from({length:12},(_,i)=>(i%2?a:b).acquire()));assert.equal(runs.filter(x=>x!==null).length,1);
  const attempts=await Promise.all(Array.from({length:15},(_,i)=>(i%2?a:b).consume('same-test-ip')));assert.equal(attempts.filter(x=>x===0).length,10);assert.equal(attempts.filter(x=>x>0).length,5);
  const row=(await a.db.query(`SELECT count FROM "${a.schema}".auth_attempts WHERE key=$1`,['same-test-ip'])).rows[0];assert.equal(row.count,10);
 }finally{await b.close();await destroy(a);}
});
test('round-trip JSONB em lotes preserva centavos, indicadores, reembolsos e ausência de duplicações',async()=>{
 const store=await testStore();
 const orders=Array.from({length:1101},(_,i)=>({...order,id:i+1,day:i%2?'2026-10-02':'2026-09-30'}));
 orders.push({...order,id:2001,payment:'Reembolsado',items:order.items.map(i=>({...i,refunded:1}))},{...order,id:2002,payment:'Reembolso solicitado'},{...order,id:2003,exchange:true},{...order,id:2004,status:'canceled'});
 const snapshot:Snapshot={orders,products:[{id:1,name:'Produto fictício',variants:[]}],refunds:[{orderId:2001,events:[{id:1,status:'approved',partial:true,total:1234}],issues:[]}]};
 try{
  const before=dashboard(snapshot.orders,snapshot.products,snapshot.refunds,'2026-10-01','2026-10-31');
  const run=(await store.acquire())!;await store.commit(run,snapshot,'America/Sao_Paulo');
  const read=await store.readDashboard('2026-08-01','2026-10-31');assert.deepEqual(dashboard(read.orders,read.products,read.refunds,'2026-10-01','2026-10-31'),before);
  assert.equal(read.status.coverage.orders,snapshot.orders.length);
  const next=(await store.acquire())!;await store.commit(next,snapshot,'America/Sao_Paulo');assert.equal((await store.orders()).length,snapshot.orders.length);
  assert.equal((await store.refunds())[0]?.events[0]?.total,1234);
 }finally{await destroy(store);}
});
test('transação com erro mantém a última versão publicada sem alterar os dados anteriores',async()=>{
 const store=await testStore();
 try{
  await store.commit((await store.acquire())!,{orders:[order],products:[],refunds:[]},'America/Sao_Paulo');
  const before=await store.status();const next=(await store.acquire())!;
  await assert.rejects(store.commit(next,{orders:[{...order,total:200}],products:[{id:null,name:'fake',variants:[]} as never],refunds:[]},'America/Sao_Paulo'));
  assert.equal((await store.orders())[0]?.total,order.total);assert.equal((await store.status()).version,before.version);
 }finally{await destroy(store);}
});
test('importação SQLite privada preserva dados normalizados, não copia sessões e recusa sobrescrita',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {importSqlite}=await import('../src/storage/import-sqlite.js');
 const dir=mkdtempSync(join(tmpdir(),'brazi-import-test-')),path=join(dir,'legacy.sqlite'),source=new DatabaseSync(path),store=await testStore();
 try{
  source.exec("CREATE TABLE orders(id INTEGER,data TEXT);CREATE TABLE products(id INTEGER,data TEXT);CREATE TABLE refunds(order_id INTEGER,data TEXT);CREATE TABLE runs(id INTEGER,status TEXT);CREATE TABLE meta(key TEXT,value TEXT);CREATE TABLE auth_sessions(token_hash TEXT);INSERT INTO runs VALUES(1,'success');INSERT INTO meta VALUES('timezone','America/Sao_Paulo');INSERT INTO auth_sessions VALUES('synthetic-session-not-for-import');");
  source.prepare('INSERT INTO orders VALUES(?,?)').run(order.id,JSON.stringify(order));
  await importSqlite(store,path);assert.deepEqual(await store.orders(),[order]);assert.equal((await store.status()).timezone,'America/Sao_Paulo');
  assert.equal((await store.db.query(`SELECT count(*)::int AS count FROM "${store.schema}".auth_sessions`)).rows[0].count,0);
  await assert.rejects(importSqlite(store,path),/destino comercial vazio/);assert.deepEqual(await store.orders(),[order]);
 }finally{source.close();await destroy(store);rmSync(dir,{recursive:true});}
});
