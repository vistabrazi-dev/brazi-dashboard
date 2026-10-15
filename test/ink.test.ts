import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InkClient} from '../src/ink.js';
import {report} from '../src/report.js';
import {createApp} from '../src/app.js';
const envelope=(resource='orders',rows:unknown[]=[{id:1,payment_status:'paid',order_status:'delivered'}],extra={})=>({[resource]:rows,page:1,per_page:100,total_pages:1,total_count:rows.length,...extra});
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const mock=(fn:(url:URL,init?:RequestInit)=>Response|Promise<Response>)=>((input:unknown,init?:RequestInit)=>fn(new URL(String(input)),init)) as typeof fetch;
test('usa apenas endpoint documentado, Bearer, paginação e bloqueio de redirects',async()=>{
 const client=new InkClient('test-token',mock((url,init)=>{
  assert.equal(url.origin,'https://api.reserva.ink');assert.equal(url.pathname,'/v1/stores/orders');
  assert.equal(url.searchParams.get('page'),'1');assert.equal(url.searchParams.get('per_page'),'100');
  assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer test-token');assert.equal(init?.redirect,'error');
  return response(envelope());
 }));
 assert.equal((await client.all('orders',10)).totalCount,1);
});
test('percorre todas as páginas de produtos',async()=>{
 const client=new InkClient('test',mock(url=>{
  const page=Number(url.searchParams.get('page'));
  return response(envelope('products',[{id:page,name:'Produto'}],{page,total_pages:2,total_count:2}));
 }));
 const result=await client.all('products',10);assert.equal(result.pagesRead,2);assert.equal(result.records.length,2);
});
for(const status of [401,403,429,500]) test(`HTTP ${status}: não expõe corpo nem token`,async()=>{
 const client=new InkClient('secret-token',mock(()=>response({error:'private-person@example.com secret-token'},status)));
 await assert.rejects(client.page('orders'),error=>error instanceof Error&&error.message.includes(String(status))&&!/private-person|secret-token/.test(error.message));
});
test('rejeita JSON inválido e estrutura incorreta sem exibir conteúdo',async()=>{
 await assert.rejects(new InkClient('test',mock(()=>new Response('private-content'))).page('orders'),/JSON inválido/);
 for(const data of [envelope('orders',[{quantity:'invalid',id:'private-id'}]),envelope('orders',[],{total_count:'private-value'}),{orders:[]}]) {
  await assert.rejects(new InkClient('test',mock(()=>response(data))).page('orders'),/Estrutura inválida/);
 }
});
test('rejeita paginação incoerente, repetida, incompleta ou alterada durante leitura',async()=>{
 await assert.rejects(new InkClient('test',mock(()=>response(envelope('orders',[],{page:2})))).page('orders'),/inconsistentes/);
 await assert.rejects(new InkClient('test',mock(url=>response(envelope('orders',[{id:1}],{page:Number(url.searchParams.get('page')),total_count:2,total_pages:2})))).all('orders',10),/duplicado/);
 await assert.rejects(new InkClient('test',mock(()=>response(envelope('orders',[{id:1}],{total_count:2,total_pages:2})))).all('orders',1),/incompleto/);
 await assert.rejects(new InkClient('test',mock(()=>response(envelope('orders',[],{total_count:2,total_pages:1})))).all('orders',10),/vazia/);
 await assert.rejects(new InkClient('test',mock(url=>{const page=Number(url.searchParams.get('page'));return response(envelope('orders',[{id:page}],{page,total_pages:2,total_count:page===1?2:3}));})).all('orders',10),/mudou/);
});
test('coleção vazia é aceita; tipos incorretos de itens e produtos são rejeitados',async()=>{
 assert.equal((await new InkClient('test',mock(()=>response(envelope('orders',[],{total_pages:0})))).all('orders',1)).totalCount,0);
 await assert.rejects(new InkClient('test',mock(()=>response(envelope('orders',[{items:[{quantity:'2'}]}])))).page('orders'),/Estrutura inválida/);
 await assert.rejects(new InkClient('test',mock(()=>response(envelope('products',[{product_variants:'invalid'}])))).page('products'),/Estrutura inválida/);
});
test('diagnóstico lista campos e status conhecidos, nunca valores pessoais ou status desconhecido',()=>{
 const output=JSON.stringify(report('orders',[{id:1,payment_status:'paid',order_status:'private-status',buyer:{email:'person@example.com'},'private-key@example.com':true,items:[{sku:'private-sku',quantity:1}]}]));
 assert.match(output,/paid/);assert.match(output,/buyer/);assert.match(output,/quantity/);assert.match(output,/unknownCount":1/);
 assert.doesNotMatch(output,/person@example|private-status|private-key|private-sku/);
});
test('rotas locais validam query e retornam somente resumo; health não chama API',async()=>{
 let calls=0;
 const app=createApp(new InkClient('test',mock(()=>{calls++;return response(envelope('orders',[{id:1,buyer:{email:'person@example.com'}}]));})));
 try {
  assert.equal((await app.inject('/health')).statusCode,200);assert.equal(calls,0);
  assert.equal((await app.inject('/api/orders?per_page=101')).statusCode,400);assert.equal(calls,0);
  const result=await app.inject('/api/orders');assert.equal(result.statusCode,200);assert.doesNotMatch(result.body,/person@example/);
 } finally {await app.close();}
});
