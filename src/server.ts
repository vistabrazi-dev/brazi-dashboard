import {settings,ConfigurationError} from './settings.js';
import {configureProxy} from './integration/transport.js';
import {Store} from './storage/store.js';
import {SyncService} from './integration/sync.js';
import {dashboardApp} from './dashboard-app.js';
import {startupDiagnostic,type StartupStage} from './startup-diagnostics.js';
let stage:StartupStage='runtime';
let store:Store|undefined;
let closeApplication:(()=>Promise<void>)|undefined;
try{
 process.umask(0o077);configureProxy();stage='configuration';const config=settings();
 stage='database-connect';
 store=await Store.open(config.DATABASE_URL,{schema:config.DATABASE_SCHEMA,production:config.production,max:config.DATABASE_POOL_MAX,ca:config.DATABASE_CA_CERT});
 stage='application';
 const openedStore=store,sync=new SyncService(openedStore,config.RESERVA_INK_TOKEN,config.BUSINESS_TIMEZONE,config.API_PAUSE_MS,config.SYNC_MAX_PAGES);
 const app=dashboardApp(openedStore,sync,{timezone:config.BUSINESS_TIMEZONE,...(config.DISPLAY_CURRENCY?{currency:config.DISPLAY_CURRENCY}:{}),tokenConfigured:Boolean(config.RESERVA_INK_TOKEN),auth:config.auth});
 app.addHook('onClose',async()=>{await sync.stop();await openedStore.close();});
 closeApplication=()=>app.close();stage='http-listen';
 await app.listen({host:config.host,port:config.PORT});console.log(`Brazi: servidor local na porta ${config.PORT}.`);
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close();});
}catch(error){
 console.error(startupDiagnostic(error,stage));
 // ConfigurationError contém somente textos estáticos criados pelo backend.
 if(error instanceof ConfigurationError)console.error(error.message);
 try{if(closeApplication)await closeApplication();else await store?.close();}catch{/* Nenhum erro de limpeza é serializado. */}
 process.exitCode=1;
}
