import {allocate,sum} from './money.js';
import type {Order,Product} from './models.js';
// Projeção compartilhada: reproduz exatamente o vínculo/rateio homologado no MVP.
export function productCatalog(products:Product[]){
 const names=new Map(products.map(p=>[p.id,p.name]));
 const skuMap=new Map<string,Set<number>>(),variantMap=new Map<number,number>();
 for(const product of products)for(const variant of product.variants){
  variantMap.set(variant.id,product.id);
  if(variant.sku){const ids=skuMap.get(variant.sku)??new Set<number>();ids.add(product.id);skuMap.set(variant.sku,ids);}
 }
 return {names,skuMap,variantMap};
}
export function attributeItems(order:Order,catalog:ReturnType<typeof productCatalog>){
 const discounts=allocate(sum([order.promotion!,order.paymentDiscount!]),order.items.map(i=>i.total!));
 return order.items.map((item,index)=>{
  const ids=catalog.skuMap.get(item.sku),bySku=ids?.size===1?[...ids][0]:undefined;
  const direct=item.sourceProductId!==undefined&&catalog.names.has(item.sourceProductId)?item.sourceProductId:undefined;
  const variant=item.sourceVariantId===undefined?undefined:catalog.variantMap.get(item.sourceVariantId);
  const conflicting=item.sourceProductId!==undefined&&variant!==undefined&&item.sourceProductId!==variant;
  const productId=conflicting?undefined:direct??(item.sourceProductId===undefined?(variant??bySku):undefined);
  return {key:productId===undefined?'unmapped':String(productId),name:productId===undefined?'Não associado ao catálogo':catalog.names.get(productId)!,revenueCents:item.total!-discounts[index]!,quantity:item.quantity-item.free,unmapped:productId===undefined};
 });
}
