import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {databasePool,type DatabaseOptions} from '../storage/connection.js';
import {schemaName} from '../storage/migrate.js';
import {reasonLabels} from '../domain/models.js';
import {dateValid,dashboard} from '../domain/metrics.js';
import {productIntelligence} from '../domain/product-intelligence.js';
import {preflight,verifyIdentity,endpoint,sameEndpoint,policySchema,type Policy} from './preflight.js';
const n=z.number().int().safe(),id=n.positive(),money=n.nullable();
const issues=z.array(z.string().refine(v=>Object.hasOwn(reasonLabels,v)));
const item=z.object({sku:z.string(),sourceProductId:id.optional(),sourceVariantId:id.optional(),quantity:n,free:n,refunded:n,unit:money,total:money}).strict();
const order=z.object({id,day:z.string().refine(dateValid),payment:z.string(),status:z.string(),exchange:z.boolean(),missing:z.boolean().optional(),total:money,shipping:money,freightDifference:money,promotion:money,paymentDiscount:money,items:z.array(item),issues}).strict();
const product=z.object({id,name:z.string(),variants:z.array(z.object({id,sku:z.string()}).strict())}).strict();
const refund=z.object({orderId:id,events:z.array(z.object({id,status:z.string(),partial:z.boolean(),total:money}).strict()),issues}).strict();
const run=z.object({id,status:z.enum(['success','failed']),stage:z.enum(['orders','products','refunds','waiting','saving','complete']),page:n,pages:n,processed:n,error:z.null(),started_at:z.string().datetime(),finished_at:z.string().datetime(),heartbeat:z.string().regex(/^\d+$/)}).strict();
const dataSchema=z.object({orders:z.array(z.object({id:z.string().regex(/^\d+$/),day:z.string(),seen:z.string().regex(/^\d+$/),data:order}).strict()),products:z.array(z.object({id:z.string().regex(/^\d+$/),data:product}).strict()),refunds:z.array(z.object({order_id:z.string().regex(/^\d+$/),data:refund}).strict()),runs:z.array(run),meta:z.array(z.object({key:z.literal('timezone'),value:z.string()}).strict()).max(1)}).strict();
export type Data=z.infer<typeof dataSchema>;
export function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function parseExact(text:string):unknown{
 // JSON normalizado só admite números inteiros seguros; não arredondar no JSON.parse.
 const stripped=text.replace(/"(?:[^"\\]|\\.)*"/g,'""');
 for(const token of stripped.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)??[]){if(!/^-?\d+$/.test(token)||BigInt(token)>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(token)<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('Precisão numérica recusada.');}
 return JSON.parse(text);
}
export function validateData(raw:unknown){
 const d=dataSchema.parse(raw);
 for(const list of [d.orders.map(r=>r.id),d.products.map(r=>r.id),d.refunds.map(r=>r.order_id),d.runs.map(r=>String(r.id))])if(new Set(list).size!==list.length)throw new Error('Chaves duplicadas.');
 const runIds=new Set(d.runs.map(r=>String(r.id)));
 if(!d.runs.some(r=>r.status==='success')||!d.meta.length)throw new Error('Corte ou timezone ausente.');
 new Intl.DateTimeFormat('pt-BR',{timeZone:d.meta[0]!.value});
 for(const r of d.orders)if(r.id!==String(r.data.id)||r.day!==r.data.day||!runIds.has(r.seen))throw new Error('Vínculo de pedido inválido.');
 for(const r of d.products)if(r.id!==String(r.data.id))throw new Error('Vínculo de produto inválido.');
 for(const r of d.refunds){if(r.order_id!==String(r.data.orderId)||new Set(r.data.events.map(e=>e.id)).size!==r.data.events.length)throw new Error('Vínculo de reembolso inválido.');}
 return d;
}
export function controls(d:Data){
 const orders=d.orders.map(r=>r.data),products=d.products.map(r=>r.data),refunds=d.refunds.map(r=>r.data);
 const years=[...new Set(orders.map(o=>o.day.slice(0,4)))].sort();
 const financial=years.map(year=>{const start=year+'-01-01',end=year+'-12-31',m=dashboard(orders,products,refunds,start,end),p=productIntelligence(orders,products,refunds,start,end);return {year,current:m.current,categories:m.categories,reconciliation:m.reconciliation,refunds:m.refunds,statusCounts:m.statusCounts,coverage:Object.fromEntries(Object.entries(p.coverage).map(([key,value])=>[key,typeof value==='number'&&!Number.isInteger(value)?String(value):value]))};});
 const orderIds=new Set(d.orders.map(r=>r.id));
 const amounts=Object.fromEntries(['total','shipping','freightDifference','promotion','paymentDiscount'].map(k=>{const values=orders.map(o=>o[k as 'total']);return [k,{sum:values.reduce<bigint>((a,v)=>a+BigInt(v??0),0n).toString(),nulls:values.filter(v=>v===null).length}];}));
 return {counts:{orders:d.orders.length,products:d.products.length,refunds:d.refunds.length,runs:d.runs.length,meta:d.meta.length},orphanRefunds:d.refunds.filter(r=>!orderIds.has(r.order_id)).length,amounts,financial};
}
const packetSchema=z.object({version:z.literal(1),createdAt:z.string().datetime(),codeRevision:z.string().regex(/^[a-f0-9]{40}$/),sourceSchema:z.string(),data:dataSchema,controls:z.unknown(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type Packet=z.infer<typeof packetSchema>;
export function makePacket(raw:unknown,sourceSchema:string,codeRevision:string):Packet{
 if(!/^[a-f0-9]{40}$/.test(codeRevision))throw new Error('SHA de código obrigatório.');
 const data=validateData(raw),base={version:1 as const,createdAt:new Date().toISOString(),codeRevision,sourceSchema,data,controls:controls(data)};
 return {...base,sha256:digest(base)};
}
export function validatePacket(raw:unknown,expectedHash:string){
 const p=packetSchema.parse(raw),{sha256,...base}=p;
 if(!/^[a-f0-9]{64}$/.test(expectedHash)||sha256!==expectedHash||digest(base)!==sha256)throw new Error('Integridade do pacote recusada.');
 validateData(p.data);if(canonical(controls(p.data))!==canonical(p.controls))throw new Error('Reconciliação do pacote recusada.');
 return p;
}
async function readData(c:PoolClient,schema:string):Promise<Data>{
 const s=schemaName(schema);
 const orders=(await c.query(`SELECT id::text,day,seen::text,data::text FROM ${s}.orders ORDER BY id`)).rows.map(r=>({...r,data:parseExact(r.data)}));
 const products=(await c.query(`SELECT id::text,data::text FROM ${s}.products ORDER BY id`)).rows.map(r=>({...r,data:parseExact(r.data)}));
 const refunds=(await c.query(`SELECT order_id::text,data::text FROM ${s}.refunds ORDER BY order_id`)).rows.map(r=>({...r,data:parseExact(r.data)}));
 const runs=(await c.query(`SELECT id,status,stage,page,pages,processed,NULL AS error,started_at,finished_at,heartbeat::text FROM ${s}.runs WHERE id IN (SELECT DISTINCT seen FROM ${s}.orders) OR id=(SELECT MAX(id) FROM ${s}.runs WHERE status='success') OR id=(SELECT MAX(id) FROM ${s}.runs) ORDER BY id`)).rows;
 const meta=(await c.query(`SELECT key,value FROM ${s}.meta WHERE key='timezone' ORDER BY key`)).rows;
 return validateData({orders,products,refunds,runs,meta});
}
export const countsSchema=z.object({orders:n.nonnegative(),products:n.nonnegative(),refunds:n.nonnegative()}).strict();
export async function exportSnapshot(url:string,schema:string,options:DatabaseOptions&{codeRevision:string},policy:Policy,expectedCounts:z.infer<typeof countsSchema>){
 schemaName(schema);policy=policySchema.parse(policy);const expected=countsSchema.parse(expectedCounts);
 if(schema!==policy.sourceSchema||!sameEndpoint(endpoint(url),policy.source)||sameEndpoint(endpoint(url),policy.destination))throw new Error('Origem recusada.');
 const pool=databasePool(url,{...options,max:1});
 try{
  const c=await pool.connect();try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await c.query("SET LOCAL statement_timeout='30s'");await c.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
   const check=(await c.query('SHOW transaction_read_only')).rows[0];if(check.transaction_read_only!=='on')throw new Error('Exportação exige leitura.');
   const data=await readData(c,schema),p=makePacket(data,schema,options.codeRevision);
   for(const k of ['orders','products','refunds'] as const)if(data[k].length!==expected[k])throw new Error('Contagens da origem não comprovadas.');
   await c.query('COMMIT');return p;
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }finally{await pool.end();}
}
export async function importSnapshot(url:string,schema:string,raw:unknown,hash:string,policy:Policy,options:DatabaseOptions={}){
 const p=validatePacket(raw,hash);if(p.sourceSchema!==policy.sourceSchema)throw new Error('Proveniência recusada.');
 await preflight(url,schema,options,policy); // Nenhuma migração implícita: destino deve estar previamente preparado.
 const pool=databasePool(url,{...options,max:1}),s=schemaName(schema);
 try{
  const c=await pool.connect();try{
   await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='30s'");await verifyIdentity(c,policy);
   await c.query(`LOCK TABLE ${s}.runs,${s}.products,${s}.orders,${s}.refunds,${s}.meta,${s}.auth_sessions,${s}.auth_attempts IN ACCESS EXCLUSIVE MODE`);
   for(const t of ['runs','products','orders','refunds','meta','auth_sessions','auth_attempts'])if((await c.query(`SELECT EXISTS(SELECT 1 FROM ${s}.${t}) AS populated`)).rows[0].populated)throw new Error('Destino não vazio.');
   for(const r of p.data.runs)await c.query(`INSERT INTO ${s}.runs(id,status,stage,page,pages,processed,error,started_at,finished_at,heartbeat) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9)`,[r.id,r.status,r.stage,r.page,r.pages,r.processed,r.started_at,r.finished_at,r.heartbeat]);
   // Lotes parametrizados, sem SQL recebido do pacote.
   for(const [name,keys,rows] of [['products',['id','data'],p.data.products],['orders',['id','day','seen','data'],p.data.orders],['refunds',['order_id','data'],p.data.refunds],['meta',['key','value'],p.data.meta]] as const){
    for(let offset=0;offset<rows.length;offset+=250){const values:unknown[]=[],batch=rows.slice(offset,offset+250);const tuples=batch.map(r=>'('+keys.map(k=>{const v=(r as unknown as Record<string,unknown>)[k];values.push(k==='data'?canonical(v):v);return '$'+values.length;}).join(',')+')');await c.query(`INSERT INTO ${s}.${name}(${keys.join(',')}) VALUES ${tuples.join(',')}`,values);}
   }
   const next=Math.max(...p.data.runs.map(r=>r.id))+1;if(!Number.isSafeInteger(next)||next>2147483647)throw new Error('Identidade excedida.');
   await c.query(`ALTER TABLE ${s}.runs ALTER COLUMN id RESTART WITH ${next}`);
   const actual=await readData(c,schema);
   if(digest(actual)!==digest(p.data)||canonical(controls(actual))!==canonical(p.controls))throw new Error('Reconciliação do destino recusada.');
   await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  // Segunda conexão, após publicação, comprova persistência.
  const verify=await pool.connect();try{await verify.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');if(digest(await readData(verify,schema))!==digest(p.data))throw new Error('Persistência não comprovada.');await verify.query('COMMIT');}finally{verify.release();}
 }finally{await pool.end();}
}
