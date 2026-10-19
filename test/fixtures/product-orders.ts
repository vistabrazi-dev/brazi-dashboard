import type {Order,Product,RefundHistory} from '../../src/domain/models.js';
export const products:Product[]=[{id:1,name:'Camiseta Horizonte',variants:[{id:11,sku:'A'}]},{id:2,name:'Camiseta Caminhos',variants:[{id:22,sku:'B'}]},{id:3,name:'Camiseta Origem',variants:[{id:33,sku:'C'}]}];
export const item=(sku:string,quantity=1,free=0)=>({sku,quantity,free,refunded:0,unit:1000,total:quantity*1000});
export function order(id:number,overrides:Partial<Order>={}):Order {
 const items=overrides.items??[item('A'),item('B')];
 return {id,day:'2026-10-01',payment:'Pago',status:'delivered',exchange:false,total:items.reduce((n,i)=>n+i.total!,0),shipping:100,freightDifference:20,promotion:50,paymentDiscount:30,items,issues:[],...overrides};
}
export const orders:Order[]=[order(1,{items:[item('A',2),item('A'),item('B')],promotion:51,paymentDiscount:29}),order(2,{day:'2026-10-02',items:[item('A'),item('B'),item('C')]}),order(3,{day:'2026-10-03',items:[item('A'),item('UNKNOWN'),item('C',1,1)]}),order(4,{items:[{...item('A'),sourceProductId:999},item('B')]}),order(5,{items:[item('UNKNOWN')]}),order(6,{exchange:true}),order(7,{payment:'Reembolsado'}),order(8,{payment:'Reembolso solicitado'}),order(9,{status:'canceled'}),order(10,{payment:'Cancelado'}),order(11,{issues:['composition']}),order(12,{missing:true}),order(13,{payment:'Novo estado'}),order(14,{total:0}),order(15,{day:'2026-09-30'}),order(16,{status:'returned'})];
export const histories:RefundHistory[]=[{orderId:7,events:[{id:71,status:'approved',partial:true,total:500}],issues:[]}];
