import {allocate,sum} from './money.js';
import {classify} from './rules.js';
import {reasonLabels,type Order,type Product,type RefundHistory,type Category} from './models.js';
export const dateValid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function shift(day:string,days:number){const date=new Date(`${day}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
export function range(start:string,end:string){
 if(!dateValid(start)||!dateValid(end)||end<start)throw new Error('Informe um intervalo de datas válido.');
 const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
 if(days>3660)throw new Error('O intervalo máximo é de dez anos.');
 return {start,end,days,previousStart:shift(start,-days),previousEnd:shift(start,-1)};
}
interface Totals { revenueCents:number;orders:number;ticketCents:number;units:number;merchandiseCents:number;netShippingCents:number }
export function dashboard(allOrders:Order[],products:Product[],histories:RefundHistory[],start:string,end:string){
 const period=range(start,end),refundMap=new Map(histories.map(h=>[h.orderId,h]));
 const tagged=allOrders.map(order=>({order,...classify(order,refundMap.get(order.id))}));
 const current=tagged.filter(t=>t.order.day>=start&&t.order.day<=end);
 const previous=tagged.filter(t=>t.order.day>=period.previousStart&&t.order.day<=period.previousEnd);
 const totals=(list:typeof tagged):Totals=>{
  const orders=list.filter(t=>t.category==='confirmed').map(t=>t.order);
  const revenue=sum(orders.map(o=>o.total!));
  const netShipping=sum(orders.map(o=>o.shipping!-o.freightDifference!));
  return {revenueCents:revenue,orders:orders.length,ticketCents:orders.length?Number((BigInt(revenue)+BigInt(Math.floor(orders.length/2)))/BigInt(orders.length)):0,units:sum(orders.flatMap(o=>o.items.map(i=>i.quantity-i.free))),merchandiseCents:sum([revenue,-netShipping]),netShippingCents:netShipping};
 };
 const now=totals(current),before=totals(previous);
 const changes=Object.fromEntries(['revenueCents','orders','ticketCents','units'].map(key=>{const k=key as keyof Totals;return [key,before[k]===0?(now[k]===0?0:null):(now[k]-before[k])/before[k]*100];}));
 const dailyMap=new Map<string,{revenueCents:number;orders:number}>();
 for(const item of tagged.filter(t=>t.category==='confirmed')){const slot=dailyMap.get(item.order.day)??{revenueCents:0,orders:0};slot.revenueCents=sum([slot.revenueCents,item.order.total!]);slot.orders++;dailyMap.set(item.order.day,slot);}
 const daily=Array.from({length:period.days},(_,index)=>{const date=shift(start,index),previousDate=shift(period.previousStart,index);return {date,previousDate,revenueCents:dailyMap.get(date)?.revenueCents??0,orders:dailyMap.get(date)?.orders??0,previousRevenueCents:dailyMap.get(previousDate)?.revenueCents??0};});
 const monthlyMap=new Map<string,{month:string;revenueCents:number;orders:number}>();
 for(const day of daily){const month=day.date.slice(0,7),slot=monthlyMap.get(month)??{month,revenueCents:0,orders:0};slot.revenueCents=sum([slot.revenueCents,day.revenueCents]);slot.orders+=day.orders;monthlyMap.set(month,slot);}
 const skuMap=new Map<string,Set<number>>();const names=new Map(products.map(p=>[p.id,p.name]));
 for(const product of products)for(const variant of product.variants){if(variant.sku){const ids=skuMap.get(variant.sku)??new Set<number>();ids.add(product.id);skuMap.set(variant.sku,ids);}}
 const variantMap=new Map<number,number>();for(const product of products)for(const variant of product.variants)variantMap.set(variant.id,product.id);
 const rankingMap=new Map<string,{key:string;name:string;revenueCents:number;quantity:number;orders:Set<number>;unmapped:boolean}>();
 for(const{order,category}of current){if(category!=='confirmed')continue;
  const discounts=allocate(sum([order.promotion!,order.paymentDiscount!]),order.items.map(i=>i.total!));
  order.items.forEach((item,index)=>{
   const ids=skuMap.get(item.sku),bySku=ids?.size===1?[...ids][0]:undefined;
   const direct=item.sourceProductId!==undefined&&names.has(item.sourceProductId)?item.sourceProductId:undefined;
   const variant=item.sourceVariantId===undefined?undefined:variantMap.get(item.sourceVariantId);
   const conflicting=item.sourceProductId!==undefined&&variant!==undefined&&item.sourceProductId!==variant;
   const productId=conflicting?undefined:direct??(item.sourceProductId===undefined?(variant??bySku):undefined);
   const key=productId===undefined?'unmapped':String(productId);
   const row=rankingMap.get(key)??{key,name:productId===undefined?'Não associado ao catálogo':names.get(productId)!,revenueCents:0,quantity:0,orders:new Set<number>(),unmapped:productId===undefined};
   row.revenueCents=sum([row.revenueCents,item.total!-(discounts[index]??0)]);row.quantity+=item.quantity-item.free;row.orders.add(order.id);rankingMap.set(key,row);
  });
 }
 const ranking=[...rankingMap.values()].map(r=>({...r,orders:r.orders.size})).sort((a,b)=>b.revenueCents-a.revenueCents||a.name.localeCompare(b.name));
 const categories:Record<Category,{count:number;valueCents:number}>={confirmed:{count:0,valueCents:0},exchange:{count:0,valueCents:0},refund:{count:0,valueCents:0},refund_pending:{count:0,valueCents:0},reconciliation:{count:0,valueCents:0},unpaid:{count:0,valueCents:0},complimentary:{count:0,valueCents:0}};
 const issues=new Map<string,{reason:string;label:string;count:number;valueCents:number;unknownAmounts:number}>();
 let reconciliationOrders=0,approvedRefundCents=0,approvedRefundEvents=0,pendingRefundCents=0,pendingRefundEvents=0,unknownRefundAmounts=0,logisticsRisk=0;
 const statusCounts=new Map<string,{payment:string;order:string;count:number}>();
 for(const t of current){const o=t.order,slot=categories[t.category];slot.count++;slot.valueCents=sum([slot.valueCents,o.total??0]);
  if(t.issues.length)reconciliationOrders++;
  if(t.logisticsRisk&&t.category==='confirmed')logisticsRisk++;
  for(const reason of t.issues){const row=issues.get(reason)??{reason,label:reasonLabels[reason]??'Verificação adicional necessária',count:0,valueCents:0,unknownAmounts:0};row.count++;if(o.total===null)row.unknownAmounts++;row.valueCents=sum([row.valueCents,o.total??0]);issues.set(reason,row);}
  const key=JSON.stringify([o.payment,o.status]),status=statusCounts.get(key)??{payment:o.payment,order:o.status,count:0};status.count++;statusCounts.set(key,status);
  for(const event of refundMap.get(o.id)?.events??[]){
   if(event.status==='approved'){approvedRefundEvents++;if(event.total===null||event.total<0)unknownRefundAmounts++;else approvedRefundCents=sum([approvedRefundCents,event.total]);}
   else if(event.status==='awaiting_approval'){pendingRefundEvents++;if(event.total===null||event.total<0)unknownRefundAmounts++;else pendingRefundCents=sum([pendingRefundCents,event.total]);}
  }
 }
 return {period,current:now,previous:before,changes,daily,monthly:[...monthlyMap.values()],ranking,categories,reconciliation:{orders:reconciliationOrders,reasons:[...issues.values()].sort((a,b)=>b.count-a.count)},refunds:{approvedCents:approvedRefundCents,approvedEvents:approvedRefundEvents,pendingCents:pendingRefundCents,pendingEvents:pendingRefundEvents,unknownAmounts:unknownRefundAmounts},logisticsRisk,statusCounts:[...statusCounts.values()].sort((a,b)=>b.count-a.count),sourceOrders:current.length,unmappedProducts:ranking.find(p=>p.unmapped)?.quantity??0,definitiveNetRevenue:false};
}
export type Dashboard=ReturnType<typeof dashboard>;
