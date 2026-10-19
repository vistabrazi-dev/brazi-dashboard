import type {PoolClient} from 'pg';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {databasePool,type DatabaseOptions} from '../storage/connection.js';
import {schemaName} from '../storage/migrate.js';
const identity=z.object({host:z.string().min(1),port:z.number().int().positive(),database:z.string().min(1),user:z.string().min(1)}).strict();
export const policySchema=z.object({version:z.literal(1),destination:identity,source:identity,databaseRole:z.string().min(1),sourceSchema:z.string().min(1),schema:z.string().regex(/^brazi_e1_staging(?:_[a-z0-9]+)?$/),stagingId:z.string().uuid()}).strict();
export type Policy=z.infer<typeof policySchema>;
export function endpoint(value:string){const u=new URL(value);return {host:u.hostname.toLowerCase(),port:Number(u.port||5432),database:decodeURIComponent(u.pathname.slice(1)),user:decodeURIComponent(u.username)};}
export const sameEndpoint=(a:ReturnType<typeof endpoint>,b:ReturnType<typeof endpoint>)=>JSON.stringify(a)===JSON.stringify(b);
export async function loadPolicy(){
 const path=process.env.STAGING_POLICY_PATH;if(!path)throw new Error('Política staging obrigatória.');
 try{return policySchema.parse(JSON.parse(await readFile(path,'utf8')));}catch{throw new Error('Política staging inválida ou indisponível.');}
}
export function validateDestination(url:string,schema:string,raw:Policy){
 const p=policySchema.parse(raw);schemaName(schema);schemaName(p.sourceSchema);
 for(const e of [p.source,p.destination])if(!['localhost','127.0.0.1','[::1]'].includes(e.host)&&(!e.host.endsWith('.pooler.supabase.com')||e.port!==5432||!/^.+\.[a-z0-9]+$/.test(e.user)))throw new Error('Exige Session Pooler ou ensaio local.');
 // Mesmo endpoint com outro usuário não transforma a origem em destino isolado.
 const project=(e:Policy['destination'])=>e.host.endsWith('.pooler.supabase.com')?e.user.split('.').at(-1):e.host+':'+e.port+'/'+e.database;
 if(project(p.source)===project(p.destination)||sameEndpoint(endpoint(url),p.source)||!sameEndpoint(endpoint(url),p.destination)||schema!==p.schema)throw new Error('Destino recusado pela política staging.');
 return p;
}
export async function preflight(url:string,schema:string,options:DatabaseOptions={},raw?:Policy){
 const policy=validateDestination(url,schema,raw??await loadPolicy());
 const pool=databasePool(url,{...options,max:1});
 try{
  const c=await pool.connect();try{
   await c.query('BEGIN READ ONLY');
   await c.query("SET LOCAL statement_timeout='5s'");
   await verifyIdentity(c,policy);
   await c.query('COMMIT');
  }finally{c.release();}
 }catch{throw new Error('Preflight recusado: identidade staging não comprovada.');}finally{await pool.end();}
 return policy;
}

export async function verifyIdentity(c:PoolClient,policy:Policy){
 const actual=(await c.query('SELECT current_database() AS database,current_user AS role')).rows[0];
 const rows=(await c.query('SELECT staging_id::text FROM brazi_staging_guard.identity')).rows;
 if(actual.database!==policy.destination.database||actual.role!==policy.databaseRole||rows.length!==1||rows[0]?.staging_id!==policy.stagingId)throw new Error();
}
