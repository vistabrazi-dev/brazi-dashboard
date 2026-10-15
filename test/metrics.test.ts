import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cents,allocate,sum} from '../src/domain/money.js';
import {normalizeOrder,normalizeRefunds} from '../src/domain/normalize.js';
import {classify} from '../src/domain/rules.js';
import {dashboard,range} from '../src/domain/metrics.js';
import type {Order,Product,RefundHistory} from '../src/domain/models.js';
export const order=(id:number,overrides:Partial<Order>={}):Order=>({id,day:'2026-10-10',payment:'Pago',status:'delivered',exchange:false,total:10000,shipping:1000,freightDifference:0,promotion:1000,paymentDiscount:0,items:[{sku:'A',quantity:2,free:0,refunded:0,unit:5000,total:10000}],issues:[],...overrides});
const products:Product[]=[{id:1,name:'Camiseta',variants:[{id:1,sku:'A'}]}];
test('moeda preserva centavos, aceita formatos locais não ambíguos e rejeita valores inválidos',()=>{
 assert.equal(cents('0.10'),10);assert.equal(cents('0.20'),20);assert.equal(sum([cents('0.1')!,cents('0.2')!]),30);
 assert.equal(cents('1,234.56'),123456);assert.equal(cents('1.234,56'),123456);assert.equal(cents('123,45'),12345);assert.equal(cents('-0.01'),-1);
 for(const value of ['NaN','1e3','1.2345',null,'R$ pessoa','999999999999999999'])assert.equal(cents(value),null);
});
test('normalização aplica fuso comercial e valida identidade financeira sem persistir dados pessoais',()=>{
 const normalized=normalizeOrder({id:1,created_at:'2026-10-02T01:00:00Z',payment_status:'Pago',order_status:'delivered',is_exchange:false,total_value:'100.00',shipping_value:'12.00',freight_value_difference:'2.00',promotion_value:'5.00',payment_discount_value:'5.00',buyer:{email:'private@example.com'},items:[{sku:'A',quantity:2,unit_value:'50.00',total_value:'100.00',free_quantity:0,refunded_quantity:0}]},'America/Sao_Paulo');
 assert.equal(normalized.day,'2026-10-01');assert.deepEqual(normalized.issues,[]);assert.doesNotMatch(JSON.stringify(normalized),/private@example|buyer/);
});
test('indicadores usam apenas base paga conservadora e comparam intervalos inclusivos equivalentes',()=>{
 const rows=[order(1),order(2,{day:'2026-09-30',total:5000,shipping:0,promotion:5000}),order(3,{exchange:true}),order(4,{status:'canceled'}),order(5,{payment:'Expirado',status:'waiting_payment'}),order(6,{payment:'Reembolsado'}),order(7,{total:0}),order(8,{payment:'Reembolso solicitado'}),order(9,{payment:'Cancelado'})];
 const d=dashboard(rows,products,[],'2026-10-01','2026-10-10');
 assert.equal(d.current.revenueCents,10000);assert.equal(d.current.orders,1);assert.equal(d.current.ticketCents,10000);assert.equal(d.current.units,2);assert.equal(d.current.merchandiseCents,9000);
 assert.equal(d.previous.revenueCents,5000);assert.equal(d.changes.revenueCents,100);assert.equal(d.period.previousStart,'2026-09-21');assert.equal(d.period.previousEnd,'2026-09-30');
 assert.equal(d.categories.exchange.count,1);assert.equal(d.categories.refund.count,1);assert.equal(d.categories.refund_pending.count,1);assert.equal(d.categories.complimentary.count,1);assert.equal(d.definitiveNetRevenue,false);
 assert.equal(d.ranking[0]?.revenueCents,9000);assert.equal(d.ranking[0]?.quantity,2);assert.equal(d.daily.length,10);assert.equal(d.daily[0]?.revenueCents,0);
});
test('quantidades gratuitas são excluídas e centavos do ranking fecham após rateio',()=>{
 const row=order(1,{total:299,promotion:1,shipping:0,items:[{sku:'A',quantity:2,free:1,refunded:0,unit:50,total:100},{sku:'B',quantity:1,free:0,refunded:0,unit:100,total:100},{sku:'C',quantity:1,free:0,refunded:0,unit:100,total:100}]});
 const d=dashboard([row],products,[],'2026-10-01','2026-10-31');
 assert.deepEqual(allocate(1,[100,100,100]),[1,0,0]);assert.equal(d.current.units,3);assert.equal(sum(d.ranking.map(p=>p.revenueCents)),299);assert.equal(d.unmappedProducts,2);
});
test('SKU ambíguo não inventa associação e agrupamento não duplica pedidos',()=>{
 const d=dashboard([order(1)], [...products,{id:2,name:'Outro',variants:[{id:2,sku:'A'}]}],[],'2026-10-01','2026-10-31');assert.equal(d.ranking.length,1);assert.equal(d.ranking[0]?.unmapped,true);assert.equal(d.ranking[0]?.orders,1);
});
test('reembolso parcial fica separado, não reduz duas vezes a base confirmada e expõe legado',()=>{
 const partial=order(1,{payment:'Reembolsado',items:[{sku:'A',quantity:3,free:0,refunded:1,unit:10000,total:30000}]}),legacy=order(2,{payment:'Reembolsado'});
 const histories:RefundHistory[]=[{orderId:1,events:[{id:1,status:'approved',partial:true,total:2500}],issues:[]}];
 const d=dashboard([partial,legacy,order(3)],products,histories,'2026-10-01','2026-10-31');
 assert.equal(d.current.revenueCents,10000);assert.equal(d.refunds.approvedCents,2500);assert.equal(d.categories.refund.count,2);assert.equal(d.reconciliation.orders,1);assert.equal(d.reconciliation.reasons[0]?.reason,'refund_missing');
});
test('Pago/canceled, Cancelado/delivered, status desconhecido e inconsistências não entram em vendas',()=>{
 for(const row of [order(1,{status:'canceled'}),order(2,{payment:'Cancelado'}),order(3,{payment:'Novo status'}),order(4,{issues:['composition']}),order(5,{missing:true})]) assert.equal(classify(row).category,'reconciliation');
 assert.equal(classify(order(6,{status:'returned'})).category,'confirmed');
 assert.equal(classify(order(7,{status:'delivery_failure'})).logisticsRisk,true);
});
test('crescimento com base zero e períodos vazios não geram Infinity ou NaN',()=>{
 const d=dashboard([order(1)],products,[],'2026-10-01','2026-10-31');assert.equal(d.changes.revenueCents,null);
 const empty=dashboard([],[],[],'2026-10-01','2026-10-31');assert.equal(empty.current.ticketCents,0);assert.equal(empty.changes.revenueCents,0);assert.equal(empty.daily.length,31);
 assert.doesNotMatch(JSON.stringify(empty),/NaN|Infinity/);
});
test('limites de período, dia bissexto, média e agrupamento mensal',()=>{
 assert.throws(()=>range('2026-02-30','2026-03-10'));assert.throws(()=>range('2026-10-10','2026-10-01'));assert.throws(()=>range('2000-01-01','2026-01-01'));
 assert.equal(range('2024-02-28','2024-03-01').days,3);
 const d=dashboard([order(1,{day:'2026-09-30',total:100}),order(2,{day:'2026-10-01',total:101})],products,[],'2026-09-30','2026-10-01');assert.equal(d.monthly.length,2);assert.equal(d.current.ticketCents,101);assert.equal(d.current.revenueCents,201);
});
test('histórico de reembolso não persiste motivo livre ou eventos duplicados',()=>{
 const h=normalizeRefunds(1,{refunds:[{id:2,status:'approved',total_refund_amount:'1,234.56',partial:true,reason_description:'private-person'}]});assert.equal(h.events[0]?.total,123456);assert.doesNotMatch(JSON.stringify(h),/private-person/);
 assert.throws(()=>normalizeRefunds(1,{refunds:[{id:2},{id:2}]}));
});

test('identificadores observados em objetos opacos só vinculam produtos existentes e conflitos não são ocultados',()=>{
 const original=order(1,{items:[{...order(1).items[0]!,sku:'SKU-DIFERENTE',sourceProductId:1,sourceVariantId:1}]});
 const mapped=dashboard([original],products,[],'2026-10-01','2026-10-31');assert.equal(mapped.ranking[0]?.name,'Camiseta');assert.equal(mapped.unmappedProducts,0);
 const other={id:2,name:'Outro',variants:[{id:2,sku:'B'}]};
 const conflict=order(2,{items:[{...original.items[0]!,sourceVariantId:2}]});assert.equal(dashboard([conflict],[...products,other],[],'2026-10-01','2026-10-31').ranking[0]?.unmapped,true);
 const unknown=order(3,{items:[{...original.items[0]!,sku:'A',sourceProductId:999,sourceVariantId:undefined}]});assert.equal(dashboard([unknown],products,[],'2026-10-01','2026-10-31').ranking[0]?.unmapped,true);
});
test('precisão longa de reembolsos usa arredondamento decimal explícito, com conciliação quando necessário',()=>{
 const history=normalizeRefunds(1,{refunds:[{id:2,status:'awaiting_approval',total_refund_amount:'123.45666666666666666666666666667',partial:true},{id:3,status:'approved',total_refund_amount:'0.005',partial:true},{id:4,status:'approved',total_refund_amount:'100.000',partial:true}]});
 assert.equal(history.events[0]?.total,12346);assert.equal(history.events[1]?.total,1);assert.equal(history.events[2]?.total,10000);assert.ok(history.issues.includes('refund_precision'));assert.ok(!history.issues.includes('refund_amount'));
});
