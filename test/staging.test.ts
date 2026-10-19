import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {Store} from '../src/storage/store.js';
import {databasePool} from '../src/storage/connection.js';
import {preflight,endpoint,validateDestination,type Policy} from '../src/staging/preflight.js';
import {exportSnapshot,importSnapshot,validatePacket,makePacket,canonical,parseExact} from '../src/staging/snapshot.js';
import {createKey,readKey,writeEncrypted,readEncrypted} from '../src/staging/files.js';
import {assertInkAllowed,stagingMode} from '../src/staging-guard.js';
import {SyncService} from '../src/integration/sync.js';
import {InkClient} from '../src/ink.js';
import {pacedFetch} from '../src/integration/transport.js';
import {dashboardApp} from '../src/dashboard-app.js';
import {dashboard} from '../src/domain/metrics.js';
import {productIntelligence} from '../src/domain/product-intelligence.js';
import {orders,products,histories} from './fixtures/product-orders.js';
import {testUrl,destroy} from './helpers/database.js';
const destinationUrl=()=>{const u=new URL(testUrl());u.pathname='/brazi_stage_test';return u.toString();};
async function fixture(){
 const source=await Store.open(testUrl(),{schema:'source_'+randomBytes(6).toString('hex')}),schema='brazi_e1_staging_'+randomBytes(6).toString('hex');
 const destination=await Store.open(destinationUrl(),{schema});
 const policy:Policy={version:1,source:endpoint(testUrl()),destination:endpoint(destinationUrl()),sourceSchema:source.schema,databaseRole:(await destination.db.query('SELECT current_user AS role')).rows[0].role,schema,stagingId:randomUUID()};
 await destination.db.query('CREATE SCHEMA IF NOT EXISTS brazi_staging_guard');
 await destination.db.query('CREATE TABLE IF NOT EXISTS brazi_staging_guard.identity(staging_id uuid NOT NULL)');
 await destination.db.query('TRUNCATE brazi_staging_guard.identity');await destination.db.query('INSERT INTO brazi_staging_guard.identity VALUES($1)',[policy.stagingId]);
 const first=(await source.acquire())!;await source.commit(first,{orders,products,refunds:histories},'America/Sao_Paulo');
 // Pedido ausente preserva a referência histórica, em vez de virar uma venda nova.
 const second=(await source.acquire())!;await source.commit(second,{orders:orders.slice(1),products,refunds:histories},'America/Sao_Paulo');
 await source.db.query(`UPDATE "${source.schema}".runs SET error='PRIVATE-ERROR-MUST-NOT-EXPORT' WHERE id=$1`,[first]);
 const expected={orders:orders.length,products:products.length,refunds:histories.length};
 return {source,destination,policy,expected,async close(){await destroy(source);await destroy(destination);}};
}
test('staging bloqueia sync, endpoint, InkClient e transporte mesmo com token; zero fetch e zero aquisição',async t=>{
 const previous=process.env.BRAZI_ENV;process.env.BRAZI_ENV='staging';let acquired=0,calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('NETWORK FORBIDDEN');});
 const fake={acquire:async()=>{acquired++;return 1;}} as unknown as Store;
 const sync=new SyncService(fake,'synthetic-secret','America/Sao_Paulo');
 const app=dashboardApp(fake,sync,{timezone:'America/Sao_Paulo',tokenConfigured:true,staticRoot:'/missing'});
 try{
  assert.throws(()=>assertInkAllowed({INK_SYNC_DISABLED:'true'}),/bloqueada/);
  assert.equal(stagingMode({STAGING_POLICY_PATH:'/private/policy'}),true);
  assert.throws(()=>assertInkAllowed({BRAZI_ENV:'invalid'}));
  assert.equal((await sync.start()).accepted,false);
  const response=await app.inject({method:'POST',url:'/api/sync',headers:{'x-brazi-request':'1'},payload:{}});assert.equal(response.json().accepted,false);
  await assert.rejects(new InkClient('synthetic-secret').page('orders',1),/bloqueada/);
  await assert.rejects(pacedFetch({pauseMs:1})('https://api.reserva.ink'),/bloqueada/);
  const cli=spawnSync(process.execPath,['--import','tsx','src/sync-cli.ts'],{env:{...process.env,NODE_ENV:'production',DATABASE_URL:'do-not-connect',RESERVA_INK_TOKEN:'synthetic-secret'},encoding:'utf8'});
  assert.equal(cli.status,1);assert.doesNotMatch(cli.stdout+cli.stderr,/synthetic-secret|do-not-connect/);
  assert.equal(acquired,0);assert.equal(calls,0);
 }finally{await app.close();if(previous===undefined)delete process.env.BRAZI_ENV;else process.env.BRAZI_ENV=previous;}
});
test('preflight rejeita produção, outro usuário, mesmo projeto e marcador incorreto antes de migrar',async()=>{
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'brazi-g2-'));const previous={mode:process.env.BRAZI_ENV,path:process.env.STAGING_POLICY_PATH};
 try{
  await preflight(destinationUrl(),f.policy.schema,{},f.policy);
  assert.throws(()=>validateDestination(testUrl(),f.policy.schema,f.policy));
  assert.throws(()=>validateDestination(destinationUrl().replace('brazi_test@','other@'),f.policy.schema,f.policy));
  assert.throws(()=>validateDestination(destinationUrl(),f.policy.schema,{...f.policy,source:{...f.policy.destination,user:'different'}}));
  const remote={...f.policy,source:{host:'synthetic.pooler.supabase.com',port:5432,database:'postgres',user:'reader.sameproject'},destination:{host:'synthetic.pooler.supabase.com',port:5432,database:'postgres',user:'writer.sameproject'}};
  assert.throws(()=>validateDestination('postgresql://writer.sameproject@synthetic.pooler.supabase.com/postgres',remote.schema,remote));
  await assert.rejects(preflight(destinationUrl(),f.policy.schema,{}, {...f.policy,stagingId:randomUUID()}),/Preflight recusado/);
  const bad={...f.policy,schema:'brazi_e1_staging_nevercreated',stagingId:randomUUID()};const path=join(dir,'policy.json');await writeFile(path,JSON.stringify(bad));
  process.env.BRAZI_ENV='staging';process.env.STAGING_POLICY_PATH=path;
  await assert.rejects(Store.open(destinationUrl(),{schema:bad.schema}),/Preflight recusado/);
  assert.equal((await f.destination.db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[bad.schema])).rowCount,0);
 }finally{if(previous.mode===undefined)delete process.env.BRAZI_ENV;else process.env.BRAZI_ENV=previous.mode;if(previous.path===undefined)delete process.env.STAGING_POLICY_PATH;else process.env.STAGING_POLICY_PATH=previous.path;await rm(dir,{recursive:true,force:true});await f.close();}
});
test('snapshot sintético criptografado preserva MVP/E1, vínculos, precisão, nulidade e persistência; recusa repetição',async()=>{
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'brazi-g2-'));
 try{
  const packet=await exportSnapshot(testUrl(),f.source.schema,{codeRevision:'a'.repeat(40)},f.policy,f.expected);
  assert.doesNotMatch(canonical(packet),/PRIVATE-ERROR|auth_sessions|token_hash|buyer/);
  assert.equal(packet.data.runs.length,2);assert.equal(packet.data.orders[0]?.seen,'1');assert.equal(packet.data.orders[0]?.data.missing,true);
  const keyPath=join(dir,'key'),path=join(dir,'snapshot');await createKey(keyPath);const key=await readKey(keyPath);await writeEncrypted(path,canonical(packet),key);
  assert.equal((await stat(keyPath)).mode&0o077,0);assert.equal((await stat(path)).mode&0o077,0);
  assert.doesNotMatch((await readFile(path)).toString(),/Camiseta|orders|PRIVATE-ERROR/);
  await assert.rejects(writeEncrypted(path,'x',key));
  await assert.rejects(readEncrypted(path,randomBytes(32)));
  const raw=parseExact(await readEncrypted(path,key));
  await importSnapshot(destinationUrl(),f.policy.schema,raw,packet.sha256,f.policy);
  const source=await f.source.readDashboard('2026-10-01','2026-10-31'),dest=await f.destination.readDashboard('2026-10-01','2026-10-31');
  assert.deepEqual(dashboard(source.orders,source.products,source.refunds,'2026-10-01','2026-10-31'),dashboard(dest.orders,dest.products,dest.refunds,'2026-10-01','2026-10-31'));
  assert.deepEqual(productIntelligence(source.orders,source.products,source.refunds,'2026-10-01','2026-10-31'),productIntelligence(dest.orders,dest.products,dest.refunds,'2026-10-01','2026-10-31'));
  const reexport=await exportSnapshot(destinationUrl(),f.destination.schema,{codeRevision:'a'.repeat(40)}, {...f.policy,source:f.policy.destination,sourceSchema:f.destination.schema},f.expected).catch(()=>null);
  assert.equal(reexport,null); // Exportador não aceita inverter origem/destino da política.
  await assert.rejects(importSnapshot(destinationUrl(),f.policy.schema,raw,packet.sha256,f.policy),/não vazio/);
  assert.equal((await f.destination.db.query(`SELECT count(*)::int AS n FROM "${f.policy.schema}".auth_sessions`)).rows[0].n,0);
  const next=await f.destination.acquire();assert.equal(next,3);
 }finally{await rm(dir,{recursive:true,force:true});await f.close();}
});
test('pacote adulterado, campo pessoal, precisão insegura, órfão novo e origem parcial são recusados',async()=>{
 const f=await fixture();try{
  const p=await exportSnapshot(testUrl(),f.source.schema,{codeRevision:'a'.repeat(40)},f.policy,f.expected);
  await assert.rejects(exportSnapshot(testUrl(),f.source.schema,{codeRevision:'a'.repeat(40)},f.policy,{...f.expected,orders:0}),/Contagens/);
  const altered=structuredClone(p);altered.data.orders[0]!.data.total=5;assert.throws(()=>validatePacket(altered,p.sha256));
  const personal=structuredClone(p.data);(personal.orders[0]!.data as unknown as Record<string,unknown>).buyer={email:'synthetic@example.com'};assert.throws(()=>makePacket(personal,f.source.schema,'a'.repeat(40)));
  const broken=structuredClone(p.data);broken.orders[0]!.seen='999';assert.throws(()=>makePacket(broken,f.source.schema,'a'.repeat(40)));
  assert.throws(()=>parseExact('{"value":9007199254740993}'));
  assert.throws(()=>parseExact('{"value":9007199254740990.5}'));
  assert.equal((parseExact('{"sku":"1.5e10","value":9007199254740991}') as {value:number}).value,Number.MAX_SAFE_INTEGER);
  await assert.rejects(importSnapshot(destinationUrl(),f.policy.schema,altered,p.sha256,f.policy));
  assert.equal((await f.destination.orders()).length,0);
  const variety=structuredClone(p.data),first=variety.orders[0]!.data;
  first.total=null;first.shipping=null;first.promotion=0;first.items[0]!.unit=-1;first.items[0]!.sourceVariantId=Number.MAX_SAFE_INTEGER;first.issues=['invalid_money','negative_money'];
  variety.refunds.push({order_id:'999999',data:{orderId:999999,events:[],issues:[]}});
  const preserved=makePacket(variety,f.source.schema,'a'.repeat(40));await importSnapshot(destinationUrl(),f.policy.schema,preserved,preserved.sha256,f.policy);
  assert.deepEqual((await f.destination.orders()).find(o=>o.id===first.id),first);
  assert.ok((await f.destination.refunds()).some(r=>r.orderId===999999));
 }finally{await f.close();}
});
test('falha de reconciliação após INSERT/RESTART desfaz toda a carga e a identidade',async()=>{
 const f=await fixture();try{
  const p=await exportSnapshot(testUrl(),f.source.schema,{codeRevision:'a'.repeat(40)},f.policy,f.expected),s='"'+f.policy.schema+'"';
  await f.destination.db.query(`CREATE FUNCTION ${s}.corrupt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.data=jsonb_set(NEW.data,'{shipping}','999'); RETURN NEW; END $$`);
  await f.destination.db.query(`CREATE TRIGGER synthetic_corruption BEFORE INSERT ON ${s}.orders FOR EACH ROW EXECUTE FUNCTION ${s}.corrupt()`);
  await assert.rejects(importSnapshot(destinationUrl(),f.policy.schema,p,p.sha256,f.policy),/Reconciliação/);
  for(const table of ['orders','products','refunds','runs','meta'])assert.equal((await f.destination.db.query(`SELECT count(*)::int AS n FROM ${s}.${table}`)).rows[0].n,0);
  assert.equal(await f.destination.acquire(),1);
 }finally{await f.close();}
});
test('exportação mantém um único snapshot READ ONLY apesar de atualização concorrente na origem sintética',async t=>{
 const f=await fixture();let changed=false;const sql:string[]=[];const original=pg.Client.prototype.query;
 t.mock.method(pg.Client.prototype,'query',async function(this:pg.Client,...args:unknown[]){
  const query=String(args[0]);sql.push(query);
  const result=await (original as (...args:unknown[])=>Promise<unknown>).apply(this,args);
  if(!changed&&query.includes('data::text FROM')&&query.includes('.orders ORDER BY')){changed=true;await f.source.db.query(`UPDATE "${f.source.schema}".products SET data=jsonb_set(data,'{name}','"NEW-SYNTHETIC-NAME"')`);}
  return result;
 });
 try{
  const p=await exportSnapshot(testUrl(),f.source.schema,{codeRevision:'a'.repeat(40)},f.policy,f.expected);
  assert.equal(changed,true);assert.equal(p.data.products[0]?.data.name,products[0]?.name);
  assert.ok(sql.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.equal(sql.filter(s=>s==='COMMIT').length,1);
 }finally{t.mock.restoreAll();await f.close();}
});
test('CLI completa key/preflight/migrate/export/import sem dotenv/fallback e não registra segredo ou registros',async()=>{
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'brazi-g2-cli-'));
 try{
  const path=join(dir,'policy.json'),counts=join(dir,'counts.json'),key=join(dir,'key'),snapshot=join(dir,'snapshot');
  await writeFile(path,JSON.stringify(f.policy));await writeFile(counts,JSON.stringify(f.expected));
  const env={...process.env,NODE_ENV:'test',BRAZI_ENV:'staging',INK_SYNC_DISABLED:'true',DATABASE_URL:'postgresql://never-use-this-fallback',RESERVA_INK_TOKEN:'synthetic-secret-cli',STAGING_CODE_REVISION:'a'.repeat(40),STAGING_POLICY_PATH:path,STAGING_SOURCE_URL:testUrl(),STAGING_SOURCE_SCHEMA:f.source.schema,STAGING_DESTINATION_URL:destinationUrl(),STAGING_SOURCE_COUNTS_PATH:counts,STAGING_KEY_PATH:key,STAGING_SNAPSHOT_PATH:snapshot};
  function run(action:string,patch:NodeJS.ProcessEnv={}){const result=spawnSync(process.execPath,['--import','tsx','src/staging-cli.ts',action],{env:{...env,...patch},encoding:'utf8',timeout:15000});assert.doesNotMatch(result.stdout+result.stderr,/synthetic-secret-cli|never-use-this-fallback|Camiseta|PRIVATE-ERROR|postgresql:\/\//);return result;}
  for(const action of ['key','preflight','migrate'])assert.equal(run(action).status,0);
  const exported=run('export');assert.equal(exported.status,0);const hash=exported.stdout.match(/[a-f0-9]{64}/)?.[0];assert.ok(hash);
  assert.equal(run('import',{STAGING_EXPECTED_SHA256:hash,STAGING_CODE_REVISION:'b'.repeat(40)}).status,1);
  assert.equal(run('import',{STAGING_EXPECTED_SHA256:hash}).status,0);
  assert.equal(run('import',{STAGING_EXPECTED_SHA256:hash}).status,1);
  assert.equal(run('preflight',{STAGING_DESTINATION_URL:''}).status,1);
  assert.equal(run('preflight',{STAGING_DESTINATION_URL:testUrl()}).status,1);
  const bytes=await readFile(snapshot);bytes[bytes.length-20]^=1;await writeFile(snapshot,bytes);
  await assert.rejects(readEncrypted(snapshot,await readKey(key)));
 }finally{await rm(dir,{recursive:true,force:true});await f.close();}
});
test('leitor RLS sem política SELECT não produz snapshot falsamente vazio',async()=>{
 const f=await fixture(),role='reader_'+randomBytes(6).toString('hex');let created=false;
 try{
  await f.source.db.query(`CREATE ROLE "${role}" LOGIN`);created=true;
  await f.source.db.query(`GRANT USAGE ON SCHEMA "${f.source.schema}" TO "${role}"`);
  await f.source.db.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${f.source.schema}" TO "${role}"`);
  const url=new URL(testUrl());url.username=role;
  await assert.rejects(exportSnapshot(url.toString(),f.source.schema,{codeRevision:'a'.repeat(40)}, {...f.policy,source:endpoint(url.toString())},f.expected));
 }finally{await f.close();if(created){const pool=databasePool(testUrl());try{await pool.query(`DROP ROLE "${role}"`);}finally{await pool.end();}}}
});
