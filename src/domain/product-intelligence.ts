import {range,shift} from './metrics.js';
import {classify} from './rules.js';
import {sum} from './money.js';
import {attributeItems,productCatalog} from './product-attribution.js';
import type {Order,Product,RefundHistory} from './models.js';
export const PAIR_CANDIDATE_LIMIT=100;
export type ProductRow={key:string;name:string;revenueCents:number;quantity:number;orders:number;unmapped:boolean};
export type ProductPoint={date:string;revenueCents:number;quantity:number;orders:number};
const percent=(part:number,total:number)=>total?part/total*100:null;
export function productIntelligence(orders:Order[],products:Product[],histories:RefundHistory[],start:string,end:string){
 const period=range(start,end),catalog=productCatalog(products),refunds=new Map(histories.map(h=>[h.orderId,h]));
 const ranking=new Map<string,ProductRow>(),series=new Map<string,Map<string,ProductPoint>>(),baskets:string[][]=[];
 const coverage={sourceOrders:0,confirmedOrders:0,excludedOrders:0,totalLines:0,mappedLines:0,unmappedLines:0,totalUnits:0,mappedUnits:0,unmappedUnits:0,totalRevenueCents:0,mappedRevenueCents:0,unmappedRevenueCents:0,ordersWithMappedPurchases:0,fullyMappedBaskets:0,partiallyMappedBaskets:0,unmappedBaskets:0,emptyPaidBaskets:0};
 for(const order of orders){
  if(order.day<start||order.day>end)continue;coverage.sourceOrders++;
  if(classify(order,refunds.get(order.id)).category!=='confirmed'){coverage.excludedOrders++;continue;}
  coverage.confirmedOrders++;
  const lines=attributeItems(order,catalog),seen=new Set<string>(),basket=new Set<string>();let unknownPurchase=false,paidLines=0;
  for(const line of lines){
   coverage.totalLines++;coverage.totalUnits=sum([coverage.totalUnits,line.quantity]);coverage.totalRevenueCents=sum([coverage.totalRevenueCents,line.revenueCents]);
   if(line.unmapped){coverage.unmappedLines++;coverage.unmappedUnits=sum([coverage.unmappedUnits,line.quantity]);coverage.unmappedRevenueCents=sum([coverage.unmappedRevenueCents,line.revenueCents]);}
   else{coverage.mappedLines++;coverage.mappedUnits=sum([coverage.mappedUnits,line.quantity]);coverage.mappedRevenueCents=sum([coverage.mappedRevenueCents,line.revenueCents]);}
   const row=ranking.get(line.key)??{key:line.key,name:line.name,revenueCents:0,quantity:0,orders:0,unmapped:line.unmapped};
   row.revenueCents=sum([row.revenueCents,line.revenueCents]);row.quantity=sum([row.quantity,line.quantity]);if(!seen.has(line.key)){row.orders++;seen.add(line.key);}ranking.set(line.key,row);
   const days=series.get(line.key)??new Map<string,ProductPoint>(),point=days.get(order.day)??{date:order.day,revenueCents:0,quantity:0,orders:0};
   point.revenueCents=sum([point.revenueCents,line.revenueCents]);point.quantity=sum([point.quantity,line.quantity]);days.set(order.day,point);series.set(line.key,days);
   if(line.quantity>0){paidLines++;if(line.unmapped)unknownPurchase=true;else basket.add(line.key);}
  }
  for(const key of seen)series.get(key)!.get(order.day)!.orders++;
  if(!paidLines)coverage.emptyPaidBaskets++;
  else if(!basket.size)coverage.unmappedBaskets++;
  else{coverage.ordersWithMappedPurchases++;if(unknownPurchase)coverage.partiallyMappedBaskets++;else coverage.fullyMappedBaskets++;}
  baskets.push([...basket]);
 }
 const rows=[...ranking.values()].sort((a,b)=>b.revenueCents-a.revenueCents||a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
 // Limite explícito de universo: no máximo 4.950 pares distintos, sem amostragem de pedidos.
 const candidates=rows.filter(r=>!r.unmapped&&r.quantity>0).sort((a,b)=>b.quantity-a.quantity||b.orders-a.orders||a.key.localeCompare(b.key)).slice(0,PAIR_CANDIDATE_LIMIT);
 const candidateKeys=new Set(candidates.map(p=>p.key)),pairs=new Map<string,{a:string;b:string;orders:number}>();let possiblePairOccurrences=0,analyzedPairOccurrences=0,ordersWithPairs=0;
 for(const basket of baskets){
  possiblePairOccurrences+=basket.length*(basket.length-1)/2;
  const keys=basket.filter(k=>candidateKeys.has(k)).sort((a,b)=>Number(a)-Number(b));analyzedPairOccurrences+=keys.length*(keys.length-1)/2;if(keys.length>1)ordersWithPairs++;
  for(let a=0;a<keys.length;a++)for(let b=a+1;b<keys.length;b++){const key=keys[a]+':'+keys[b],row=pairs.get(key)??{a:keys[a]!,b:keys[b]!,orders:0};row.orders++;pairs.set(key,row);}
 }
 const combinations=[...pairs.values()].map(p=>({a:{key:p.a,name:ranking.get(p.a)!.name},b:{key:p.b,name:ranking.get(p.b)!.name},orders:p.orders,sharePct:percent(p.orders,coverage.confirmedOrders)!})).sort((a,b)=>b.orders-a.orders||Number(a.a.key)-Number(b.a.key)||Number(a.b.key)-Number(b.b.key));
 return {period,ranking:rows,series,combinations,baskets,coverage:{...coverage,unitCoveragePct:percent(coverage.mappedUnits,coverage.totalUnits),lineCoveragePct:percent(coverage.mappedLines,coverage.totalLines),revenueCoveragePct:percent(coverage.mappedRevenueCents,coverage.totalRevenueCents),basketCoveragePct:percent(coverage.fullyMappedBaskets,coverage.confirmedOrders)},basketAnalysis:{scope:'period' as 'period'|'product',denominatorOrders:coverage.confirmedOrders,ordersWithPairs,candidateLimit:PAIR_CANDIDATE_LIMIT as number|null,candidateProducts:candidates.length,excludedProducts:rows.filter(r=>!r.unmapped&&r.quantity>0).length-candidates.length,possiblePairOccurrences,analyzedPairOccurrences,pairOccurrenceCoveragePct:percent(analyzedPairOccurrences,possiblePairOccurrences),limited:possiblePairOccurrences>analyzedPairOccurrences}};
}
export type ProductIntelligence=ReturnType<typeof productIntelligence>;
export function productEvolution(data:ProductIntelligence,key:string,granularity:'day'|'month'){
 const product=data.ranking.find(p=>p.key===key);if(!product)return null;
 const days=data.series.get(key)!,daily=Array.from({length:data.period.days},(_,i)=>{const date=shift(data.period.start,i);return days.get(date)??{date,revenueCents:0,quantity:0,orders:0};});
 if(granularity==='day')return {product,granularity,points:daily};
 const months=new Map<string,ProductPoint>();for(const day of daily){const date=day.date.slice(0,7),point=months.get(date)??{date,revenueCents:0,quantity:0,orders:0};point.revenueCents=sum([point.revenueCents,day.revenueCents]);point.quantity=sum([point.quantity,day.quantity]);point.orders+=day.orders;months.set(date,point);}
 return {product,granularity,points:[...months.values()]};
}
