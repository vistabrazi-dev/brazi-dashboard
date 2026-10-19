import {stagingMode} from '../staging-guard.js';
import {preflight,verifyIdentity} from '../staging/preflight.js';
import type {Pool,PoolClient} from 'pg';
import type {Order,Product,RefundHistory,Snapshot} from '../domain/models.js';
import {databasePool,type DatabaseOptions} from './connection.js';
import {migrate,schemaName,transaction} from './migrate.js';
export interface Run {id:number;status:string;stage:string;page:number;pages:number;processed:number;error:string|null;started_at:string;finished_at:string|null;heartbeat:string}
export class Store {
 private constructor(readonly db:Pool,readonly schema:string){}
 static async open(url:string,options:DatabaseOptions&{schema?:string}={}){
  const schema=options.schema??'brazi';schemaName(schema);
  const policy=stagingMode()?await preflight(url,schema,options):undefined;
  const pool=databasePool(url,options);
  try{await migrate(pool,schema,policy?c=>verifyIdentity(c,policy):undefined);return new Store(pool,schema);}catch(error){await pool.end();throw error;}
 }
 private table(name:string){return `${schemaName(this.schema)}.${name}`;}
 private lock(client:PoolClient,kind:string){return client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[this.schema+':'+kind]);}
 async acquire():Promise<number|null>{return transaction(this.db,async client=>{
  await this.lock(client,'sync');
  await client.query(`UPDATE ${this.table('runs')} SET status='failed',error='Execução interrompida; tente novamente.',finished_at=$1 WHERE status='running' AND heartbeat<$2`,[new Date().toISOString(),Date.now()-120000]);
  if((await client.query(`SELECT id FROM ${this.table('runs')} WHERE status='running'`)).rowCount)return null;
  return (await client.query(`INSERT INTO ${this.table('runs')}(status,stage,started_at,heartbeat) VALUES('running','orders',$1,$2) RETURNING id`,[new Date().toISOString(),Date.now()])).rows[0]!.id as number;
 });}
 async progress(id:number,stage:string,page:number,pages:number,processed:number){await this.db.query(`UPDATE ${this.table('runs')} SET stage=$1,page=$2,pages=$3,processed=$4,heartbeat=$5 WHERE id=$6 AND status='running'`,[stage,page,pages,processed,Date.now(),id]);}
 async heartbeat(id:number){await this.db.query(`UPDATE ${this.table('runs')} SET heartbeat=$1 WHERE id=$2 AND status='running'`,[Date.now(),id]);}
 async fail(id:number,error:string){await this.db.query(`UPDATE ${this.table('runs')} SET status='failed',error=$1,finished_at=$2 WHERE id=$3 AND status='running'`,[error,new Date().toISOString(),id]);}
 async commit(run:number,snapshot:Snapshot,timezone:string){await transaction(this.db,async client=>{
  await this.lock(client,'sync');
  const owner=(await client.query(`SELECT status FROM ${this.table('runs')} WHERE id=$1 FOR UPDATE`,[run])).rows[0];
  if(owner?.status!=='running')throw new Error('Esta execução perdeu a concessão de sincronização.');
  // Lotes reduzem round-trips para o Supabase e mantêm a publicação atômica.
  for(let offset=0;offset<snapshot.orders.length;offset+=500){
   const batch=snapshot.orders.slice(offset,offset+500);
   await client.query(`INSERT INTO ${this.table('orders')}(id,day,data,seen) SELECT (value->>'id')::bigint,value->>'day',value,$2 FROM jsonb_array_elements($1::jsonb) ON CONFLICT(id) DO UPDATE SET day=excluded.day,data=excluded.data,seen=excluded.seen`,[JSON.stringify(batch),run]);
  }
  await client.query(`UPDATE ${this.table('orders')} SET data=jsonb_set(data,'{missing}','true'::jsonb) WHERE seen<>$1`,[run]);
  for(const [collection,key,rows] of [['products','id',snapshot.products],['refunds','order_id',snapshot.refunds]] as const){
   for(let offset=0;offset<rows.length;offset+=500){
    await client.query(`INSERT INTO ${this.table(collection)}(${key},data) SELECT (value->>$2)::bigint,value FROM jsonb_array_elements($1::jsonb) ON CONFLICT(${key}) DO UPDATE SET data=excluded.data`,[JSON.stringify(rows.slice(offset,offset+500)),collection==='products'?'id':'orderId']);
   }
  }
  await client.query(`INSERT INTO ${this.table('meta')}(key,value) VALUES('timezone',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,[timezone]);
  await client.query(`UPDATE ${this.table('runs')} SET status='success',stage='complete',finished_at=$1,heartbeat=$2 WHERE id=$3`,[new Date().toISOString(),Date.now(),run]);
 });}
 private async readOrders(client:Pool|PoolClient,start?:string,end?:string):Promise<Order[]>{return (await client.query(`SELECT data FROM ${this.table('orders')} ${start&&end?'WHERE day BETWEEN $1 AND $2':''} ORDER BY day,id`,start&&end?[start,end]:[])).rows.map(r=>r.data as Order);}
 orders(start?:string,end?:string){return this.readOrders(this.db,start,end);}
 async products():Promise<Product[]>{return (await this.db.query(`SELECT data FROM ${this.table('products')} ORDER BY id`)).rows.map(r=>r.data);}
 async refunds():Promise<RefundHistory[]>{return (await this.db.query(`SELECT data FROM ${this.table('refunds')} ORDER BY order_id`)).rows.map(r=>r.data);}
 private async readStatus(client:Pool|PoolClient){
  const run=(await client.query<Run>(`SELECT * FROM ${this.table('runs')} ORDER BY id DESC LIMIT 1`)).rows[0];
  const success=(await client.query(`SELECT id,finished_at FROM ${this.table('runs')} WHERE status='success' ORDER BY id DESC LIMIT 1`)).rows[0];
  const raw=(await client.query(`SELECT MIN(day) AS first,MAX(day) AS last,COUNT(*) AS orders FROM ${this.table('orders')}`)).rows[0]!;
  const products=(await client.query(`SELECT COUNT(*) AS count FROM ${this.table('products')}`)).rows[0];
  const tz=(await client.query(`SELECT value FROM ${this.table('meta')} WHERE key='timezone'`)).rows[0];
  return {run:run?{id:run.id,status:run.status==='running'&&Number(run.heartbeat)<Date.now()-120000?'interrupted':run.status,stage:run.stage,page:run.page,pages:run.pages,processed:run.processed,error:run.error}:null,lastSuccess:success?.finished_at??null,version:Number(success?.id??0),coverage:{first:raw.first as string|null,last:raw.last as string|null,orders:Number(raw.orders)},products:Number(products?.count??0),timezone:(tz?.value??null) as string|null};
 }
 status(){return transaction(this.db,c=>this.readStatus(c),true);}
 readDashboard(start:string,end:string){return transaction(this.db,async client=>({status:await this.readStatus(client),orders:await this.readOrders(client,start,end),products:(await client.query(`SELECT data FROM ${this.table('products')} ORDER BY id`)).rows.map(r=>r.data as Product),refunds:(await client.query(`SELECT data FROM ${this.table('refunds')} ORDER BY order_id`)).rows.map(r=>r.data as RefundHistory)}),true);}
 async authenticated(tokenHash:string,tag:string){return Boolean((await this.db.query(`SELECT 1 FROM ${this.table('auth_sessions')} WHERE token_hash=$1 AND credential_tag=$2 AND expires_at>$3`,[tokenHash,tag,Date.now()])).rowCount);}
 async forget(tokenHash:string){await this.db.query(`DELETE FROM ${this.table('auth_sessions')} WHERE token_hash=$1`,[tokenHash]);}
 async session(tokenHash:string,tag:string,expires:number,previous?:string){await transaction(this.db,async client=>{
  await client.query(`DELETE FROM ${this.table('auth_sessions')} WHERE expires_at<=$1 OR credential_tag<>$2 OR token_hash=$3`,[Date.now(),tag,previous??'']);
  await client.query(`INSERT INTO ${this.table('auth_sessions')}(token_hash,credential_tag,expires_at) VALUES($1,$2,$3)`,[tokenHash,tag,expires]);
 });}
 async consume(ipKey:string){return transaction(this.db,async client=>{
  await this.lock(client,'auth-attempts');const now=Date.now(),window=15*60*1000;
  await client.query(`DELETE FROM ${this.table('auth_attempts')} WHERE reset_at<=$1`,[now]);
  const limits=[{key:ipKey,maximum:10},{key:'global',maximum:60}];
  for(const limit of limits){const row=(await client.query(`SELECT count,reset_at FROM ${this.table('auth_attempts')} WHERE key=$1`,[limit.key])).rows[0];if(row&&row.count>=limit.maximum)return Math.max(1,Math.ceil((Number(row.reset_at)-now)/1000));}
  for(const limit of limits)await client.query(`INSERT INTO ${this.table('auth_attempts')}(key,count,reset_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=${this.table('auth_attempts')}.count+1`,[limit.key,now+window]);
  return 0;
 });}
 async close(){await this.db.end();}
}
