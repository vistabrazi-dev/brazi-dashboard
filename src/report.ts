import {orderStatuses,paymentStatuses} from './ink.js';
// Somente nomes previstos no contrato. Chaves desconhecidas nunca são impressas.
const orderFields = ['id','created_at','rsv_factory_id','order_status','formatted_order_status','payment_method','payment_status','pix','is_exchange','exchangeable','items_editable','payment_discount_value','total_value','promotion_code','promotion_value','shipping_value','freight_value_difference','kickback_value','tracking_url','delivery','buyer','items','shipping_address','billing_address'];
const productFields = ['id','name','slug','description','store_product_url','visible_in_store','customizable_by_buyer','total_sales_count','product_cluster_id','price','promotional_price','tags','main_image_url','approval_status','status','created_at','updated_at','store','product_type','product_variants'];
const itemFields = ['id','quantity','unit_value','total_value','created_at','produced_at','produced','counter_produce','sku','art_image_url','mockup_image_url','unit_ink_base_price','unit_additional_service_price','unit_kickback_without_promotion_value','free_quantity','refunded_quantity','product_variant','product_v2'];
function fields(rows:Record<string,unknown>[], allowed:string[]) {return allowed.filter(key=>rows.some(row=>Object.hasOwn(row,key)));}
function statuses(rows:Record<string,unknown>[],key:string,allowed:readonly string[]) {
 const present = rows.map(row=>row[key]);
 return {values:allowed.filter(v=>present.includes(v)),unknownCount:present.filter(v=>typeof v==='string'&&!allowed.includes(v)).length,missingCount:present.filter(v=>v===undefined).length};
}
export function report(resource:'orders'|'products', rows:Record<string,unknown>[]) {
 return {fields:fields(rows,resource==='orders'?orderFields:productFields),...(resource==='orders'?{
 itemFields:fields(rows.flatMap(r=>Array.isArray(r.items)?r.items:[]),itemFields),
 paymentStatus:statuses(rows,'payment_status',paymentStatuses),orderStatus:statuses(rows,'order_status',orderStatuses)
 }:{} )};
}
