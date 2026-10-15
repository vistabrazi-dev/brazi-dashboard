import {configureProxy,pacedFetch} from './integration/transport.js';
import {loadConfig} from './config.js';
import {InkClient} from './ink.js';
import {report} from './report.js';
try {
 configureProxy(); const config = loadConfig(); const client = new InkClient(config.RESERVA_INK_TOKEN,pacedFetch());
 for (const resource of ['orders','products'] as const) {
  const result = await client.all(resource,config.DIAGNOSTIC_MAX_PAGES);
  console.log(JSON.stringify({resource,authenticated:true,paginationValidated:true,pagesRead:result.pagesRead,totalCount:result.totalCount,...report(resource,result.records)},null,2));
 }
 console.log('Diagnóstico concluído. Coleções vazias não validam a estrutura dos registros. Status refletem apenas os registros observados.');
} catch(error) {
 console.error(error instanceof Error ? error.message : 'Falha no diagnóstico.'); process.exitCode=1;
}
