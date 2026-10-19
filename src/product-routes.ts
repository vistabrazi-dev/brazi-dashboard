import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Store} from './storage/store.js';
import {range} from './domain/metrics.js';
import {productIntelligence,productEvolution,type ProductIntelligence} from './domain/product-intelligence.js';
export class AnalyticsBusyError extends Error {}
const key=z.string().regex(/^(unmapped|[1-9]\d{0,15})$/).refine(v=>v==='unmapped'||Number.isSafeInteger(Number(v)));
const common={start:z.string(),end:z.string()};
const paging={page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)};
export const productQuery=z.object({...common,...paging,search:z.string().max(120).default(''),sort:z.enum(['value','quantity','orders','name']).default('value'),direction:z.enum(['asc','desc']).default('desc')}).strict();
export const basketQuery=z.object({...common,...paging,productKey:key.optional(),direction:z.enum(['asc','desc']).default('desc')}).strict();
export const evolutionQuery=z.object({...common,granularity:z.enum(['day','month']).default('day')}).strict();
export function paginate<T>(rows:T[],page:number,pageSize:number){const pages=Math.ceil(rows.length/pageSize),actual=Math.min(page,Math.max(1,pages));return {rows:rows.slice((actual-1)*pageSize,actual*pageSize),pagination:{page:actual,pageSize,total:rows.length,pages}};}
const normalize=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
export function productRows(data:ProductIntelligence,query:z.infer<typeof productQuery>){
 const search=normalize(query.search.trim()),field={value:'revenueCents',quantity:'quantity',orders:'orders',name:'name'}[query.sort] as 'revenueCents'|'quantity'|'orders'|'name';
 const rows=data.ranking.filter(p=>normalize(p.name).includes(search)).sort((a,b)=>{const left=a[field],right=b[field],delta=typeof left==='string'?left.localeCompare(String(right),'pt-BR'):left-Number(right);return delta*(query.direction==='asc'?1:-1)||a.key.localeCompare(b.key);});
 return paginate(rows,query.page,query.pageSize);
}
export function basketRows(data:ProductIntelligence,query:z.infer<typeof basketQuery>){
 let rows=data.combinations,analysis=data.basketAnalysis;
 if(query.productKey){
  // Investigação de um produto: todos os parceiros, em O(itens), sem limite de 100.
  // As cestas no cache contêm somente chaves de produto, nunca pedidos/compradores.
  const key=query.productKey,names=new Map(data.ranking.map(p=>[p.key,p.name])),partners=new Map<string,number>();let ordersWithPairs=0,occurrences=0;
  for(const basket of data.baskets){if(!basket.includes(key))continue;if(basket.length>1)ordersWithPairs++;
   for(const partner of basket)if(partner!==key){partners.set(partner,(partners.get(partner)??0)+1);occurrences++;}
  }
  rows=[...partners].map(([partner,orders])=>{const [a,b]=[key,partner].sort((x,y)=>Number(x)-Number(y));return {a:{key:a!,name:names.get(a!)!},b:{key:b!,name:names.get(b!)!},orders,sharePct:orders/analysis.denominatorOrders*100};}).sort((a,b)=>b.orders-a.orders||Number(a.a.key)-Number(b.a.key)||Number(a.b.key)-Number(b.b.key));
  analysis={...analysis,scope:'product',ordersWithPairs,candidateLimit:null,candidateProducts:data.ranking.filter(p=>!p.unmapped&&p.quantity>0).length,excludedProducts:0,possiblePairOccurrences:occurrences,analyzedPairOccurrences:occurrences,pairOccurrenceCoveragePct:occurrences?100:null,limited:false};
 }
 if(query.direction==='asc')rows=[...rows].reverse();return {...paginate(rows,query.page,query.pageSize),analysis};
}
export function installProductRoutes(app:FastifyInstance,store:Store,options:{timezone:string;currency?:string}){
 type Snapshot={data:ProductIntelligence;metadata:{snapshotVersion:number;lastSuccess:string|null;timezone:string;currency:string|null}};
 const cache=new Map<string,Snapshot>(),inflight=new Map<string,Promise<Snapshot>>();
 async function load(start:string,end:string){
  const version=(await store.status()).version,requestKey=JSON.stringify([version,start,end]),cached=cache.get(requestKey);if(cached)return cached;
  const pending=inflight.get(requestKey);if(pending)return pending;
  if(inflight.size>=2)throw new AnalyticsBusyError();
  const task=(async()=>{
   const snapshot=await store.readDashboard(start,end),data=productIntelligence(snapshot.orders,snapshot.products,snapshot.refunds,start,end);
   const result={data,metadata:{snapshotVersion:snapshot.status.version,lastSuccess:snapshot.status.lastSuccess as string|null,timezone:snapshot.status.timezone??options.timezone,currency:options.currency??null}};
   const actualKey=JSON.stringify([result.metadata.snapshotVersion,start,end]);if(cache.size>=4)cache.delete(cache.keys().next().value!);cache.set(actualKey,result);return result;
  })();inflight.set(requestKey,task);try{return await task;}finally{inflight.delete(requestKey);}
 }
 const validPeriod=(start:string,end:string)=>{try{range(start,end);return true;}catch{return false;}};
 app.get('/api/intelligence/products',async(request,reply)=>{
  const parsed=productQuery.safeParse(request.query);if(!parsed.success||!validPeriod(parsed.data.start,parsed.data.end))return reply.code(400).send({error:'Filtros inválidos. Confira período, ordenação, busca e paginação.'});
  const q=parsed.data,{data,metadata}=await load(q.start,q.end);return {...metadata,period:data.period,coverage:data.coverage,basketAnalysis:data.basketAnalysis,...productRows(data,q)};
 });
 app.get('/api/intelligence/products/:key',async(request,reply)=>{
  const parsed=evolutionQuery.safeParse(request.query),params=z.object({key}).safeParse(request.params);
  if(!parsed.success||!params.success||!validPeriod(parsed.data.start,parsed.data.end))return reply.code(400).send({error:'Produto ou período inválido.'});
  const q=parsed.data,{data,metadata}=await load(q.start,q.end),evolution=productEvolution(data,params.data.key,q.granularity);
  if(!evolution)return reply.code(404).send({error:'Este produto não tem vendas confirmadas no período.'});
  return {...metadata,period:data.period,...evolution};
 });
 app.get('/api/intelligence/baskets',async(request,reply)=>{
  const parsed=basketQuery.safeParse(request.query);if(!parsed.success||!validPeriod(parsed.data.start,parsed.data.end))return reply.code(400).send({error:'Filtros de cestas inválidos.'});
  const q=parsed.data,{data,metadata}=await load(q.start,q.end);return {...metadata,period:data.period,...basketRows(data,q)};
 });
 app.addHook('onClose',async()=>{cache.clear();inflight.clear();});
}
