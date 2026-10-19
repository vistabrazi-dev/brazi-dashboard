import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {orders,products,histories,order,item} from './fixtures/product-orders.js';
import {dashboard} from '../src/domain/metrics.js';
import {productIntelligence,productEvolution,PAIR_CANDIDATE_LIMIT} from '../src/domain/product-intelligence.js';
import {productQuery,productRows,basketRows,basketQuery} from '../src/product-routes.js';
const start='2026-10-01',end='2026-10-03';
test('golden do MVP pré-E1 permanece integralmente idêntico após compartilhar atribuição',()=>{
 const expected=JSON.parse(readFileSync('test/fixtures/e1-mvp-golden.json','utf8'));assert.deepEqual(dashboard(orders,products,histories,start,end),expected);
});
test('ranking, centavos, unidades, pedidos distintos e cobertura fecham com o MVP',()=>{
 const baseline=dashboard(orders,products,histories,start,end),data=productIntelligence(orders,products,histories,start,end);
 assert.deepEqual(data.ranking,baseline.ranking);assert.equal(data.coverage.confirmedOrders,baseline.current.orders);assert.equal(data.coverage.totalRevenueCents,baseline.current.merchandiseCents);assert.equal(data.coverage.totalUnits,baseline.current.units);assert.equal(data.coverage.unmappedUnits,baseline.unmappedProducts);
 assert.equal(data.coverage.mappedRevenueCents+data.coverage.unmappedRevenueCents,data.coverage.totalRevenueCents);assert.equal(data.coverage.mappedUnits+data.coverage.unmappedUnits,data.coverage.totalUnits);assert.equal(data.coverage.mappedLines+data.coverage.unmappedLines,data.coverage.totalLines);
 assert.equal(data.coverage.fullyMappedBaskets+data.coverage.partiallyMappedBaskets+data.coverage.unmappedBaskets+data.coverage.emptyPaidBaskets,data.coverage.confirmedOrders);
 assert.equal(data.coverage.excludedOrders+data.coverage.confirmedOrders,data.coverage.sourceOrders);
});
test('pares diferentes deduplicados, gratuitos e desconhecidos fora do par, N preservado',()=>{
 const data=productIntelligence(orders,products,histories,start,end);
 const pair=(a:string,b:string)=>data.combinations.find(p=>p.a.key===a&&p.b.key===b);
 // Pedidos 1 (A repetido), 2 (ABC) e 16 (AB retornado, elegível).
 assert.equal(pair('1','2')?.orders,3);assert.equal(pair('1','3')?.orders,1);assert.equal(pair('2','3')?.orders,1);assert.equal(data.combinations.length,3);
 assert.equal(pair('1','2')?.sharePct,3/data.coverage.confirmedOrders*100);
 assert.equal(data.basketAnalysis.denominatorOrders,data.coverage.confirmedOrders);assert.ok(data.coverage.unmappedBaskets>0);assert.ok(data.coverage.partiallyMappedBaskets>0);
 for(const pair of data.combinations){assert.notEqual(pair.a.key,pair.b.key);assert.notEqual(pair.a.key,'unmapped');assert.notEqual(pair.b.key,'unmapped');}
 const filtered=basketRows(data,basketQuery.parse({start,end,productKey:'3'}));assert.equal(filtered.rows.length,2);assert.equal(filtered.rows[0]?.sharePct,1/data.coverage.confirmedOrders*100);
});
test('cada série diária/mensal fecha com seu produto, inclui zeros e valores não associados',()=>{
 const data=productIntelligence(orders,products,histories,start,end);
 for(const row of data.ranking)for(const granularity of ['day','month'] as const){const detail=productEvolution(data,row.key,granularity)!;for(const [pointField,totalField] of [['quantity','quantity'],['revenueCents','revenueCents'],['orders','orders']] as const)assert.equal(detail.points.reduce((n,p)=>n+p[pointField],0),row[totalField]);}
 const detail=productEvolution(data,'2','day')!;assert.equal(detail.points.length,3);assert.equal(detail.points[2]?.quantity,0);assert.equal(productEvolution(data,'999','day'),null);
 const span=productIntelligence([order(10,{day:'2026-09-30'}),order(11,{day:'2026-10-02'})],products,[],'2026-09-30','2026-10-03');assert.equal(productEvolution(span,'1','month')?.points.length,2);
});
test('vazio, uma cesta, unidades gratuitas puras e períodos inválidos não inventam resultados',()=>{
 const empty=productIntelligence([],[],[],start,end);assert.deepEqual(empty.combinations,[]);assert.equal(empty.coverage.unitCoveragePct,null);assert.equal(empty.coverage.basketCoveragePct,null);assert.doesNotMatch(JSON.stringify(empty),/NaN|Infinity/);
 const free=productIntelligence([order(1,{items:[item('A',1,1),item('B',1,1)]})],products,[],start,end);assert.equal(free.coverage.emptyPaidBaskets,1);assert.equal(free.combinations.length,0);assert.equal(free.coverage.totalUnits,0);
 assert.throws(()=>productIntelligence([],[],[],'2026-02-30',end));
});
test('limite explícito de candidatos mantém denominador e mede pares não avaliados',()=>{
 const catalog=Array.from({length:PAIR_CANDIDATE_LIMIT+1},(_,i)=>({id:i+1,name:`Produto ${i+1}`,variants:[{id:i+1,sku:`P${i+1}`}]}));
 const data=productIntelligence([order(1,{items:catalog.map(p=>item(p.variants[0]!.sku))}),order(2,{items:[item('missing')]})],catalog,[],start,end);
 assert.equal(data.ranking.length,102);assert.equal(data.basketAnalysis.candidateProducts,100);assert.equal(data.combinations.length,4950);assert.equal(data.basketAnalysis.excludedProducts,1);assert.equal(data.basketAnalysis.limited,true);assert.equal(data.basketAnalysis.possiblePairOccurrences,5050);assert.equal(data.basketAnalysis.analyzedPairOccurrences,4950);assert.equal(data.combinations[0]?.sharePct,50);assert.equal(data.coverage.confirmedOrders,2);
 const included=new Set(data.combinations.flatMap(pair=>[pair.a.key,pair.b.key])),outside=data.ranking.find(p=>!p.unmapped&&!included.has(p.key))!;const selected=basketRows(data,basketQuery.parse({start,end,productKey:outside.key,pageSize:50}));assert.equal(selected.pagination.total,100);assert.equal(selected.analysis.scope,'product');assert.equal(selected.analysis.candidateLimit,null);assert.equal(selected.analysis.pairOccurrenceCoveragePct,100);assert.equal(selected.rows[0]?.sharePct,50);
});
test('busca, ordenação das três métricas, desempate e paginação são determinísticos',()=>{
 const data=productIntelligence(orders,products,histories,start,end);
 for(const sort of ['value','quantity','orders','name'] as const){const asc=productRows(data,productQuery.parse({start,end,sort,direction:'asc',pageSize:1,page:999}));assert.equal(asc.rows.length,1);assert.equal(asc.pagination.page,asc.pagination.pages);}
 assert.equal(productRows(data,productQuery.parse({start,end,search:'horizonte'})).rows[0]?.key,'1');assert.equal(productRows(data,productQuery.parse({start,end,search:'nao associado'})).rows[0]?.key,'unmapped');assert.equal(productRows(data,productQuery.parse({start,end,search:'inexistente'})).pagination.total,0);
 assert.equal(productQuery.safeParse({start,end,sort:'__proto__'}).success,false);
});
