import type {Order,Product} from '../src/domain/models';
export const productNames=['Horizonte','Caminhos','Origem','Brisa','Aurora','Raízes','Entrelinhas','Travessia','Essência','Novo Dia','Infinito','Maré','Pausa','Semente','Passos','Sopro','Ritmo','Alvorada','Presença','Ciclo','Encontro','Movimento','Livre','Calma','Norte','Sul','Luz','Tempo','Terra','Sol','Vento','Água','Viva','Ser'];
export const demoProducts:Product[]=productNames.map((name,i)=>({id:i+1,name:`Camiseta ${name}`,variants:[{id:100+i,sku:`DEMO-${i+1}`}]}));
function line(id:number,quantity=1){return {sourceProductId:id,sourceVariantId:99+id,sku:`DEMO-${id}`,quantity,free:0,refunded:0,unit:7900+id*250,total:(7900+id*250)*quantity};}
function sale(id:number,ids:number[],unknown=false):Order{
 const items=ids.map((p,i)=>line(p,i===0&&id%4===0?2:1));if(unknown)items.push({...line(999),sourceProductId:999,sourceVariantId:1098,sku:'DEMO-UNKNOWN',unit:7900,total:7900});
 return {id,day:`2026-10-${String(1+id%18).padStart(2,'0')}`,payment:'Pago',status:'delivered',exchange:false,total:items.reduce((n,i)=>n+i.total,0)+300,shipping:1200,freightDifference:200,promotion:500,paymentDiscount:200,items,issues:[]};
}
export const demoOrders:Order[]=[...Array.from({length:54},(_,i)=>sale(i+1,i%3===0?[1,2]:i%3===1?[1,3]:[2,3],i%11===0)),...Array.from({length:31},(_,i)=>sale(100+i,[4+i])),sale(200,[1],true),{...sale(201,[1]),exchange:true},{...sale(202,[2]),status:'canceled'}];
