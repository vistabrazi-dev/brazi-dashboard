export interface Item { sku: string; sourceProductId?:number; sourceVariantId?:number; quantity: number; free: number; refunded: number; unit: number | null; total: number | null }
export interface Order {
 id: number; day: string; payment: string; status: string; exchange: boolean; missing?: boolean;
 total: number | null; shipping: number | null; freightDifference: number | null; promotion: number | null; paymentDiscount: number | null;
 items: Item[]; issues: string[];
}
export interface Product { id: number; name: string; variants: { id: number; sku: string }[] }
export interface Refund { id: number; status: string; partial: boolean; total: number | null }
export interface RefundHistory { orderId: number; events: Refund[]; issues: string[] }
export interface Snapshot { orders: Order[]; products: Product[]; refunds: RefundHistory[] }
export type Category = 'confirmed' | 'exchange' | 'refund' | 'refund_pending' | 'reconciliation' | 'unpaid' | 'complimentary';
export const reasonLabels: Record<string,string> = {
 missing_source:'Pedido ausente na última leitura integral', unknown_payment:'Status de pagamento não reconhecido',
 unknown_order:'Status operacional não reconhecido', invalid_money:'Valor monetário ausente ou inválido',
 negative_money:'Valor monetário negativo', invalid_quantity:'Quantidade de itens inconsistente', missing_items:'Pedido sem itens válidos',
 composition:'Total não corresponde a itens, frete e descontos', item_total:'Total do item difere de preço × quantidade',
 excess_discount:'Descontos superiores ao total de itens', paid_canceled:'Pagamento pago com pedido cancelado ou incompatível',
 canceled_delivered:'Pagamento cancelado com pedido entregue', refund_missing:'Reembolsado sem histórico financeiro',
 refund_not_approved:'Reembolsado sem evento aprovado', refund_mismatch:'Quantidades e histórico de reembolso divergentes',
 refund_amount:'Montante de reembolso inválido', refund_precision:'Reembolso com fração adicional arredondada ao centavo', paid_refund:'Pedido pago com reembolso registrado',
 refund_excess:'Reembolso aprovado superior ao total do pedido',
};
export const normalized = (s:string) => s.normalize('NFD').replace(/\p{M}/gu,'').trim().toLowerCase();
export const isPaid = (s:string) => ['pago','paid','succeeded'].includes(normalized(s));
export const isRefunded = (s:string) => ['reembolsado','refunded'].includes(normalized(s));
export const isRefundPending = (s:string) => ['reembolso solicitado','refund_requested'].includes(normalized(s));
