import {test,expect,type Page} from '@playwright/test';
import {productIntelligence} from '../src/domain/product-intelligence';
import {productRows,basketRows,productQuery,basketQuery} from '../src/product-routes';
import {dashboard} from '../src/domain/metrics';
import type {Order} from '../src/domain/models';
const order:Order={id:1,day:'2026-10-10',payment:'Pago',status:'delivered',exchange:false,total:10000,shipping:1000,freightDifference:0,promotion:1000,paymentDiscount:0,items:[{sku:'A',quantity:2,free:0,refunded:0,unit:5000,total:10000}],issues:[]};
const status={run:null,lastSuccess:'2026-10-14T17:00:00Z',version:1,coverage:{first:'2026-09-01',last:'2026-10-10',orders:4},products:1,timezone:'America/Sao_Paulo',currency:null,tokenConfigured:true};
async function setup(page:Page,options:{empty?:boolean;failed?:boolean}={}){
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let posts=0;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/auth/session')return route.fulfill({json:{enabled:false,authenticated:true}});
  if(url.pathname==='/api/status')return route.fulfill({json:options.empty?{...status,lastSuccess:null,coverage:{first:null,last:null,orders:0}}:posts?{...status,run:{status:'running',stage:'orders',page:1,pages:124,processed:100},version:1}:status});
  if(url.pathname==='/api/sync'){posts++;expect(route.request().headers()['x-brazi-request']).toBe('1');return route.fulfill({status:202,json:{accepted:true,id:2}});}
  if(options.failed)return route.fulfill({status:500,json:{error:'Falha de teste controlada.'}});
  if(url.pathname.startsWith('/api/intelligence/')){
   const q={start:url.searchParams.get('start')!,end:url.searchParams.get('end')!};
   const bi=productIntelligence([order],[{id:1,name:'Camiseta Brazi',variants:[{id:1,sku:'A'}]}],[],q.start,q.end),metadata={snapshotVersion:1,lastSuccess:status.lastSuccess};
   if(url.pathname.endsWith('/baskets'))return route.fulfill({json:{...metadata,analysis:bi.basketAnalysis,...basketRows(bi,basketQuery.parse(Object.fromEntries(url.searchParams)))}});
   return route.fulfill({json:{...metadata,coverage:bi.coverage,basketAnalysis:bi.basketAnalysis,...productRows(bi,productQuery.parse(Object.fromEntries(url.searchParams)))}});
  }
  const data=dashboard([order,{...order,id:2,day:'2026-09-01',total:20000,items:[{...order.items[0]!,unit:10000,total:20000}]},{...order,id:3,exchange:true},{...order,id:4,status:'canceled'}],[{id:1,name:'Camiseta Brazi',variants:[{id:1,sku:'A'}]}],[],url.searchParams.get('start')!,url.searchParams.get('end')!);
  return route.fulfill({json:data});
 });
 return {errors,posts:()=>posts};
}
test('indicadores, gráficos, filtros, ranking e conciliação funcionam sem chamadas externas',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});const state=await setup(page);const external:string[]=[];page.on('request',r=>{if(r.url().includes('api.reserva.ink'))external.push(r.url());});
 await page.goto('/');await expect(page.locator('.kpi-value').first()).toHaveText('100,00');await expect(page.getByRole('heading',{name:'Evolução diária'})).toBeVisible();await expect(page.getByRole('heading',{name:'Evolução mensal'})).toBeVisible();
 await page.getByLabel('Data inicial',{exact:true}).fill('2026-10-01');await page.getByLabel('Data final',{exact:true}).fill('2026-10-31');await page.getByRole('button',{name:'Aplicar'}).click();await expect(page.locator('.period-description')).toContainText('31/08/2026');
 await page.getByRole('button',{name:'Produtos',exact:true}).click();await expect(page.getByRole('heading',{name:'Produtos & vendas.'})).toBeVisible();await expect(page.getByText('Camiseta Brazi',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Quantidade',exact:true}).click();
 await page.getByRole('button',{name:'Conciliação',exact:true}).click();await expect(page.getByRole('heading',{name:'Pendências de conciliação'})).toBeVisible();await expect(page.getByText('Pagamento pago com pedido cancelado ou incompatível')).toBeVisible();await expect(page.getByRole('heading',{name:'Pagamento × pedido'})).toBeVisible();expect(state.errors).toEqual([]);expect(external).toEqual([]);
});
test('atualização manual apresenta progresso e impede cliques duplicados',async({page})=>{
 const state=await setup(page);await page.goto('/');await expect(page.locator('.kpi-value').first()).toBeVisible();await page.getByRole('button',{name:'Atualizar dados'}).click();await expect(page.getByRole('button',{name:'Sincronizando…',exact:true})).toBeDisabled();await expect(page.getByRole('status')).toContainText('1/124');expect(state.posts()).toBe(1);expect(state.errors).toEqual([]);
});
test('estado inicial não mostra indicadores fictícios e falhas podem ser repetidas',async({page})=>{
 await setup(page,{empty:true});await page.goto('/');await expect(page.getByRole('button',{name:'Sincronizar Reserva INK'})).toBeVisible();await expect(page.locator('.kpi')).toHaveCount(0);
 await page.unroute('**/api/**');await setup(page,{failed:true});await page.reload();await expect(page.getByRole('alert')).toContainText('Falha de teste controlada.');await expect(page.getByRole('button',{name:'Tentar novamente'})).toBeVisible();
});
test('layout móvel mantém filtros e navegação utilizáveis sem transbordamento',async({page})=>{
 await page.setViewportSize({width:390,height:844});const state=await setup(page);await page.goto('/');await expect(page.locator('.kpi-value').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Abrir menu'}).click();await page.getByRole('button',{name:'Produtos',exact:true}).click();await expect(page.locator('.sidebar')).not.toHaveClass(/open/);await expect(page.getByRole('heading',{name:'Produtos & vendas.'})).toBeVisible();expect(state.errors).toEqual([]);
});
