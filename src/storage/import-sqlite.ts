// Ferramenta de transição apenas; o servidor e as sessões usam exclusivamente PostgreSQL.
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {Store} from './store.js';
const integer=z.number().int().safe(),id=integer.positive(),money=integer.nullable();
const item=z.object({sku:z.string(),sourceProductId:id.optional(),sourceVariantId:id.optional(),quantity:integer,free:integer,refunded:integer,unit:money,total:money}).strict();
const order=z.object({id,day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),payment:z.string(),status:z.string(),exchange:z.boolean(),missing:z.boolean().optional(),total:money,shipping:money,freightDifference:money,promotion:money,paymentDiscount:money,items:z.array(item),issues:z.array(z.string())}).strict();
const product=z.object({id,name:z.string(),variants:z.array(z.object({id,sku:z.string()}).strict())}).strict();
const refund=z.object({orderId:id,events:z.array(z.object({id,status:z.string(),partial:z.boolean(),total:money}).strict()),issues:z.array(z.string())}).strict();
export async function importSqlite(store:Store,path:string){
 const source=new DatabaseSync(path,{readOnly:true});let run:number|null=null;
 try{
  source.exec('BEGIN');
  if(!source.prepare("SELECT id FROM runs WHERE status='success' LIMIT 1").get())throw new Error('Origem sem sincronização concluída.');
  const timezone=source.prepare("SELECT value FROM meta WHERE key='timezone'").get()?.value;
  if(typeof timezone!=='string')throw new Error('Fuso ausente na origem.');
  new Intl.DateTimeFormat('pt-BR',{timeZone:timezone});
  const snapshot={orders:source.prepare('SELECT data FROM orders ORDER BY id').all().map(r=>order.parse(JSON.parse(String(r.data)))),products:source.prepare('SELECT data FROM products ORDER BY id').all().map(r=>product.parse(JSON.parse(String(r.data)))),refunds:source.prepare('SELECT data FROM refunds ORDER BY order_id').all().map(r=>refund.parse(JSON.parse(String(r.data))))};
  source.exec('COMMIT');
  run=await store.acquire();if(run===null)throw new Error('Sincronização em andamento.');
  const status=await store.status();
  if(status.version||status.coverage.orders||status.products||(await store.refunds()).length)throw new Error('Importação exige destino comercial vazio.');
  await store.commit(run,snapshot,timezone);
 }catch(error){if(run!==null)await store.fail(run,'Importação não concluída; dados anteriores preservados.');throw error;}finally{source.close();}
}
