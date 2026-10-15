import { z } from 'zod';
export class InkError extends Error {}
export const paymentStatuses = ['pending','paid','succeeded','waiting_payment','awaiting_analysis','free','refund_requested','refunded','canceled','failed','expired','not_authorized','dispute','chargeback'] as const;
export const orderStatuses = ['waiting_payment','awaiting_analysis','payment_refused','expired','paid','refund_requested','refunded','canceled','waiting_approval','awaiting_stamp','awaiting_production','production_delayed','waiting_to_be_sent','waiting_to_be_collected','sent','preparing_for_delivery','delivery_in_progress','left_for_delivery','delivery_failure','delivery_interrupted','waiting_sender_action','return_started','returned','delivered','delivered_correios'] as const;
const money = z.string().optional();
const item = z.object({id:z.number().int().optional(),quantity:z.number().int().optional(),unit_value:money,total_value:money,sku:z.string().optional(),free_quantity:z.number().int().optional(),refunded_quantity:z.number().int().optional(),product_variant:z.object({}).passthrough().optional(),product_v2:z.object({}).passthrough().optional()}).passthrough();
const order = z.object({id:z.number().int().optional(),created_at:z.string().datetime({offset:true}).optional(),order_status:z.string().optional(),payment_status:z.string().optional(),is_exchange:z.boolean().optional(),total_value:money,items:z.array(item).optional()}).passthrough();
const product = z.object({id:z.number().int().optional(),name:z.string().nullable().optional(),price:z.string().nullable().optional(),product_variants:z.array(z.object({id:z.number().int().optional(),sku:z.string().nullable().optional()}).passthrough()).optional()}).passthrough();
const pagination = {page:z.number().int().min(1),per_page:z.number().int().min(1).max(100),total_pages:z.number().int().min(0),total_count:z.number().int().min(0)};
export const schemas = {orders:z.object({...pagination,orders:z.array(order)}),products:z.object({...pagination,products:z.array(product)})};
export type Resource = keyof typeof schemas;
export class InkClient {
  constructor(private token:string, private fetcher:typeof fetch = fetch) {}
  async page(resource:Resource, page=1, perPage=100) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100) throw new InkError('Paginação inválida.');
    const url = new URL(`/v1/stores/${resource}`, 'https://api.reserva.ink');
    url.searchParams.set('page',String(page)); url.searchParams.set('per_page',String(perPage));
    let response: Response;
    try { response = await this.fetcher(url,{headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)}); }
    catch { throw new InkError('Falha de conexão, redirecionamento ou timeout na API INK.'); }
    if (!response.ok) {
      const reason = response.status === 401 ? 'token ausente, inválido ou expirado' : response.status === 403 ? 'verifique escopos e plano da loja' : response.status === 429 ? 'limite de requisições; tente mais tarde' : 'falha na API';
      throw new InkError(`INK HTTP ${response.status}: ${reason}.`);
    }
    let body:unknown;
    try { body = await response.json(); } catch { throw new InkError('INK retornou JSON inválido.'); }
    const parsed = schemas[resource].safeParse(body);
    if (!parsed.success) throw new InkError(`Estrutura inválida na resposta de ${resource}; revise o contrato. Nenhum conteúdo da resposta foi registrado.`);
    const data = parsed.data;
    if (data.page !== page || data.per_page !== perPage || (data.total_count > 0 && data.total_pages < page) || data[resource as keyof typeof data] === undefined) throw new InkError('Metadados de paginação inconsistentes.');
    return data;
  }
  async all(resource:Resource,maxPages:number) {
    const records:Record<string,unknown>[] = [];
    let initialCount:number|undefined; let initialPages:number|undefined;
    const ids = new Set<number>();
    for (let page=1;page<=maxPages;page++) {
      const data = await this.page(resource,page);
      if (initialCount === undefined) {initialCount=data.total_count;initialPages=data.total_pages;}
      if (data.total_count !== initialCount || data.total_pages !== initialPages) throw new InkError('A coleção mudou durante a paginação; execute novamente.');
      const rows = 'orders' in data ? data.orders : data.products;
      if (rows.length > data.per_page || (rows.length === 0 && data.total_count > records.length)) throw new InkError('Página vazia ou tamanho inconsistente.');
      for (const row of rows) { if (row.id !== undefined) {if(ids.has(row.id)) throw new InkError('Registro duplicado entre páginas.');ids.add(row.id);} records.push(row); }
      if (page >= data.total_pages) {
        if(records.length !== data.total_count) throw new InkError('Quantidade recebida difere de total_count.');
        return {records,pagesRead:page,totalCount:data.total_count};
      }
    }
    throw new InkError('Diagnóstico incompleto: limite DIAGNOSTIC_MAX_PAGES atingido.');
  }
}
