import { isPaid,isRefunded,isRefundPending,normalized,type Order,type RefundHistory,type Category } from './models.js';
import {orderStatuses} from '../ink.js';
import {sum} from './money.js';
export function classify(order:Order,history?:RefundHistory):{category:Category;issues:string[];logisticsRisk:boolean} {
 const issues=new Set(order.issues);
 if(order.missing)issues.add('missing_source');
 const payment=normalized(order.payment);
 const known=['pago','paid','succeeded','reembolsado','refunded','reembolso solicitado','refund_requested','expirado','expired','nao autorizado','not_authorized','pendente','pending','waiting_payment','cancelado','canceled','aguardando analise','awaiting_analysis','free','gratuito','failed','falhou','dispute','chargeback'];
 if(!known.includes(payment))issues.add('unknown_payment');
 if(!(orderStatuses as readonly string[]).includes(order.status))issues.add('unknown_order');
 for(const issue of history?.issues??[])issues.add(issue);
 const approved=history?.events.filter(e=>e.status==='approved')??[];
 const refundedQty=order.items.reduce((a,i)=>a+i.refunded,0);
 const quantity=order.items.reduce((a,i)=>a+i.quantity,0);
 if(isPaid(order.payment)&&['canceled','refunded','expired','waiting_payment','payment_refused'].includes(order.status))issues.add('paid_canceled');
 if(['cancelado','canceled'].includes(payment)&&['delivered','delivered_correios'].includes(order.status))issues.add('canceled_delivered');
 if(isPaid(order.payment)&&(approved.length>0||refundedQty>0))issues.add('paid_refund');
 const recorded=isRefunded(order.payment)||order.status==='refunded';
 if(recorded){
  if(!history?.events.length)issues.add('refund_missing');
  else if(!approved.length)issues.add('refund_not_approved');
  if(approved.length&&refundedQty===0)issues.add('refund_mismatch');
  if(refundedQty>0&&!approved.length)issues.add('refund_mismatch');
  if(approved.length&&!approved.some(e=>e.partial)&&refundedQty!==quantity)issues.add('refund_mismatch');
 }
 if(approved.every(e=>e.total!==null)&&order.total!==null&&sum(approved.map(e=>e.total!))>order.total)issues.add('refund_excess');
 let category:Category;
 if(order.exchange)category='exchange';
 else if(recorded)category='refund';
 else if(isRefundPending(order.payment)||order.status==='refund_requested')category='refund_pending';
 else if(issues.size)category='reconciliation';
 else if(isPaid(order.payment))category=order.total===0?'complimentary':'confirmed';
 else category='unpaid';
 return {category,issues:[...issues],logisticsRisk:['returned','delivery_failure','delivery_interrupted','return_started'].includes(order.status)};
}
