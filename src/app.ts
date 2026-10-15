import Fastify from 'fastify';
import {z} from 'zod';
import {InkClient,InkError} from './ink.js';
import {report} from './report.js';
export function createApp(client:InkClient) {
 const app = Fastify({logger:false});
 app.get('/health',async()=>({status:'ok'}));
 for (const resource of ['orders','products'] as const) {
  app.get(`/api/${resource}`,async(request,reply)=>{
   const query=z.object({page:z.coerce.number().int().min(1).default(1),per_page:z.coerce.number().int().min(1).max(100).default(100)}).strict().safeParse(request.query);
   if(!query.success) return reply.code(400).send({error:'Use page >= 1 e per_page entre 1 e 100.'});
   try {
    const data=await client.page(resource,query.data.page,query.data.per_page);
    const rows='orders' in data?data.orders:data.products;
    // Esta etapa expõe somente diagnóstico agregado; nunca registros de clientes.
    return {page:data.page,per_page:data.per_page,total_pages:data.total_pages,total_count:data.total_count,...report(resource,rows)};
   } catch(error) {return reply.code(502).send({error:error instanceof InkError?error.message:'Falha interna na integração.'});}
  });
 }
 return app;
}
