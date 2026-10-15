import { cents, sum, refundCents } from './money.js';
import type { Order, Product, RefundHistory } from './models.js';
const object=(v:unknown):Record<string,unknown> => typeof v==='object'&&v!==null&&!Array.isArray(v)?v as Record<string,unknown>:{};
const id=(v:unknown):number=>{if(!Number.isSafeInteger(v)||Number(v)<1)throw new Error('Identificador obrigatório inválido na API.');return Number(v);};
const integer=(v:unknown):number=>Number.isSafeInteger(v)?Number(v):-1;
const formatters=new Map<string,Intl.DateTimeFormat>();
export function normalizeOrder(raw:Record<string,unknown>,timezone:string):Order {
 const issues=new Set<string>();
 let formatter=formatters.get(timezone);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});formatters.set(timezone,formatter);}
 if(typeof raw.created_at!=='string'||!Number.isFinite(Date.parse(raw.created_at)))throw new Error('Data de criação inválida na API.');
 const parts=formatter.formatToParts(new Date(raw.created_at));
 const day=['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');
 const get=(v:unknown)=>{const value=cents(v);if(value===null)issues.add('invalid_money');else if(value<0)issues.add('negative_money');return value;};
 const items=(Array.isArray(raw.items)?raw.items:[]).map(value=>{
  const item=object(value);const quantity=integer(item.quantity),free=integer(item.free_quantity),refunded=integer(item.refunded_quantity);
  if(quantity<1||free<0||refunded<0||free>quantity||refunded>quantity)issues.add('invalid_quantity');
  const unit=get(item.unit_value),total=get(item.total_value);
  if(unit!==null&&total!==null&&quantity>0&&BigInt(unit)*BigInt(quantity)!==BigInt(total))issues.add('item_total');
  const sourceProductId=object(item.product_v2).id,sourceVariantId=object(item.product_variant).id;
  return {...(Number.isSafeInteger(sourceProductId)&&Number(sourceProductId)>0?{sourceProductId:Number(sourceProductId)}:{}),...(Number.isSafeInteger(sourceVariantId)&&Number(sourceVariantId)>0?{sourceVariantId:Number(sourceVariantId)}:{}),sku:typeof item.sku==='string'?item.sku:'',quantity,free,refunded,unit,total};
 });
 if(!items.length)issues.add('missing_items');
 const order:Order={id:id(raw.id),day,payment:typeof raw.payment_status==='string'?raw.payment_status:'',status:typeof raw.order_status==='string'?raw.order_status:'',exchange:raw.is_exchange===true,total:get(raw.total_value),shipping:get(raw.shipping_value),freightDifference:get(raw.freight_value_difference),promotion:get(raw.promotion_value),paymentDiscount:get(raw.payment_discount_value),items,issues:[]};
 if([order.total,order.shipping,order.freightDifference,order.promotion,order.paymentDiscount,...items.map(i=>i.total)].every(v=>v!==null)) {
  const gross=sum(items.map(i=>i.total!));
  if(sum([gross,order.shipping!,-order.freightDifference!,-order.promotion!,-order.paymentDiscount!])!==order.total)issues.add('composition');
  if(sum([order.promotion!,order.paymentDiscount!])>gross)issues.add('excess_discount');
 }
 order.issues=[...issues];return order;
}
export function normalizeProduct(raw:Record<string,unknown>):Product {
 return {id:id(raw.id),name:typeof raw.name==='string'&&raw.name.trim()?raw.name:'Produto sem nome',variants:(Array.isArray(raw.product_variants)?raw.product_variants:[]).map(v=>{const p=object(v);return {id:id(p.id),sku:typeof p.sku==='string'?p.sku:''};})};
}
export function normalizeRefunds(orderId:number,body:unknown):RefundHistory {
 const raw=object(body);if(!Array.isArray(raw.refunds))throw new Error('Estrutura inesperada do histórico de reembolsos.');
 const issues=new Set<string>(),seen=new Set<number>();
 const events=raw.refunds.map(value=>{const r=object(value),refundId=id(r.id);if(seen.has(refundId))throw new Error('Evento de reembolso duplicado.');seen.add(refundId);const parsed=refundCents(r.total_refund_amount),total=parsed.value;if(parsed.adjusted)issues.add('refund_precision');if(total===null||total<0)issues.add('refund_amount');return {id:refundId,status:typeof r.status==='string'?r.status:'',partial:r.partial===true,total};});
 return {orderId,events,issues:[...issues]};
}
