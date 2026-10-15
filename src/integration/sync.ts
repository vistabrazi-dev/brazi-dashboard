import {InkClient,InkError,type Resource} from '../ink.js';
import {pacedFetch} from './transport.js';
import {normalizeOrder,normalizeProduct,normalizeRefunds} from '../domain/normalize.js';
import {isPaid,isRefunded,isRefundPending,type Snapshot,type Order,type Product} from '../domain/models.js';
import {Store} from '../storage/store.js';
export async function collect<T>(client:InkClient,resource:Resource,normalize:(raw:Record<string,unknown>)=>T,progress:(page:number,pages:number,processed:number)=>void|Promise<void>,maxPages=1000):Promise<T[]> {
 const result:T[]=[],ids=new Set<number>();let expectedCount:number|undefined,expectedPages:number|undefined;
 for(let page=1;page<=maxPages;page++){
  const data=await client.page(resource,page,100);
  if(expectedCount===undefined){expectedCount=data.total_count;expectedPages=data.total_pages;if(expectedPages>maxPages)throw new Error('Limite de páginas insuficiente.');}
  if(data.total_count!==expectedCount||data.total_pages!==expectedPages)throw new Error('A coleção mudou durante a leitura.');
  const rows='orders' in data?data.orders:data.products;
  if(rows.length>100||(!rows.length&&result.length<expectedCount))throw new Error('Página inconsistente.');
  for(const row of rows){if(!Number.isSafeInteger(row.id)||ids.has(row.id!))throw new Error('Identificador ausente ou duplicado.');ids.add(row.id!);result.push(normalize(row));}
  await progress(page,expectedPages!,result.length);
  if(page>=expectedPages!){if(result.length!==expectedCount)throw new Error('Contagem final inconsistente.');return result;}
 }
 throw new Error('Limite de páginas atingido.');
}
export class SyncService {
 private task?:Promise<void>;private controller?:AbortController;
 constructor(private store:Store,private token:string|undefined,private timezone:string,private pauseMs=1800,private maxPages=1000){}
 async start():Promise<{accepted:boolean;id?:number;reason?:string}>{
  if(!this.token)return {accepted:false,reason:'Configure RESERVA_INK_TOKEN no backend.'};
  const run=await this.store.acquire();if(run===null)return {accepted:false,reason:'Já existe uma sincronização em andamento.'};
  this.controller=new AbortController();this.task=this.execute(run,this.controller.signal).catch(()=>{console.error('Sincronização interrompida por indisponibilidade do banco. Última carga preservada.');});return {accepted:true,id:run};
 }
 private async execute(run:number,signal:AbortSignal){
  let stage='orders',page=0,pages=0,processed=0;
  const progress=(s:string)=>(p:number,total:number,count:number)=>{stage=s;page=p;pages=total;processed=count;return this.store.progress(run,s,p,total,count);};
  const timer=setInterval(()=>{void this.store.heartbeat(run).catch(()=>this.controller?.abort());},10000);timer.unref();
  const transport=pacedFetch({pauseMs:this.pauseMs,signal,onWait:()=>this.store.progress(run,'waiting',page,pages,processed)});
  const client=new InkClient(this.token!,transport);
  try{
   const orders=await collect<Order>(client,'orders',r=>normalizeOrder(r,this.timezone),progress('orders'),this.maxPages);
   const products=await collect<Product>(client,'products',normalizeProduct,progress('products'),this.maxPages);
   const previousRefunds=new Set((await this.store.refunds()).map(r=>r.orderId));
   const targets=orders.filter(o=>isRefunded(o.payment)||isRefundPending(o.payment)||['refunded','refund_requested'].includes(o.status)||o.items.some(i=>i.refunded>0)||(isPaid(o.payment)&&o.status==='canceled')||previousRefunds.has(o.id));
   const refunds:Snapshot['refunds']=[];await progress('refunds')(0,targets.length,0);
   for(const order of targets){
    const url=new URL(`/v1/stores/orders/${order.id}/refunds`,'https://api.reserva.ink');
    const response=await transport(url,{headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json'}});
    if(!response.ok)throw new InkError(`Histórico de reembolsos: HTTP ${response.status}. Confira store.refunds.read e tente novamente.`);
    const body:unknown=await response.json();refunds.push(normalizeRefunds(order.id,body));await progress('refunds')(refunds.length,targets.length,refunds.length);
   }
   if(signal.aborted)throw new Error('Interrompido.');
   await this.store.progress(run,'saving',0,0,orders.length);await this.store.commit(run,{orders,products,refunds},this.timezone);
  }catch(error){
   await this.store.fail(run,signal.aborted?'Sincronização interrompida. Última carga preservada.':error instanceof InkError?error.message:'Não foi possível concluir a carga: rede, estrutura ou consistência dos dados. Última carga preservada.');
  }finally{clearInterval(timer);}
 }
 async stop(){this.controller?.abort();await this.task;}
}
