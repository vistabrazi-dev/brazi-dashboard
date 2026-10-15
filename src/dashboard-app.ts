import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {Store} from './storage/store.js';
import {SyncService} from './integration/sync.js';
import {installAuth,type AuthOptions} from './auth/auth.js';
import {dashboard,range} from './domain/metrics.js';
export function dashboardApp(store:Store,sync:SyncService,options:{timezone:string;currency?:string;tokenConfigured:boolean;staticRoot?:string;auth?:AuthOptions}){
 const auth=options.auth??{enabled:false,production:false};
 const app=Fastify({logger:false,bodyLimit:4096,trustProxy:auth.production?((_address:string,hop:number)=>hop===0):false});
 installAuth(app,store,auth);const cache=new Map<string,ReturnType<typeof dashboard>>();
 app.addHook('onSend',async(request,reply,payload)=>{reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');reply.header('Cache-Control',/^\/assets\/[A-Za-z0-9_-]+\.(js|css|woff2|svg|png)(\?|$)/.test(request.url)?'public, max-age=31536000, immutable':'no-store');if(auth.production&&request.protocol==='https')reply.header('Strict-Transport-Security','max-age=31536000');if(!request.url.startsWith('/api/')) reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");return payload;});
 app.setErrorHandler((_error,_request,reply)=>reply.code(500).send({error:'Não foi possível concluir a operação.'}));
 app.get('/health',async()=>({status:'ok'}));
 app.get('/api/status',async()=>({...store.status(),tokenConfigured:options.tokenConfigured,timezone:store.status().timezone??options.timezone,currency:options.currency??null}));
 app.get('/api/dashboard',async(request,reply)=>{
  const parsed=z.object({start:z.string(),end:z.string()}).strict().safeParse(request.query);
  if(!parsed.success)return reply.code(400).send({error:'Informe início e fim do período.'});
  let period;try{period=range(parsed.data.start,parsed.data.end);}catch{return reply.code(400).send({error:'Intervalo inválido. Use datas reais, início até fim e no máximo dez anos.'});}
  const version=store.status().version,key=JSON.stringify([version,period.start,period.end]);
  let result=cache.get(key);
  if(!result){result=dashboard(store.orders(period.previousStart,period.end),store.products(),store.refunds(),period.start,period.end);if(cache.size>=12)cache.delete(cache.keys().next().value!);cache.set(key,result);}
  return result;
 });
 app.post('/api/sync',async(request,reply)=>{
  const origin=request.headers.origin;
  if(!auth.enabled&&(request.headers['x-brazi-request']!=='1'||(origin&&(()=>{try{return new URL(origin).host!==request.headers.host;}catch{return true;}})())))return reply.code(403).send({error:'Origem não permitida.'});
  const result=sync.start();return reply.code(result.accepted?202:options.tokenConfigured?409:503).send(result);
 });
 const root=options.staticRoot??resolve('web-dist');
 if(existsSync(root)){
  void app.register(fastifyStatic,{root});
  app.setNotFoundHandler((request,reply)=>request.method==='GET'&&!request.url.startsWith('/api/')&&request.headers.accept?.includes('text/html')?reply.sendFile('index.html'):reply.code(404).send({error:'Rota não encontrada.'}));
 }
 return app;
}
