import {settings,ConfigurationError} from './settings.js';
import {configureProxy} from './integration/transport.js';
import {Store} from './storage/store.js';
import {SyncService} from './integration/sync.js';
import {dashboardApp} from './dashboard-app.js';
try{
 process.umask(0o077);configureProxy();const config=settings();
 const store=new Store(config.DATABASE_PATH),sync=new SyncService(store,config.RESERVA_INK_TOKEN,config.BUSINESS_TIMEZONE,config.API_PAUSE_MS,config.SYNC_MAX_PAGES);
 const app=dashboardApp(store,sync,{timezone:config.BUSINESS_TIMEZONE,...(config.DISPLAY_CURRENCY?{currency:config.DISPLAY_CURRENCY}:{}),tokenConfigured:Boolean(config.RESERVA_INK_TOKEN),auth:config.auth});
 app.addHook('onClose',async()=>{await sync.stop();store.close();});
 await app.listen({host:config.host,port:config.PORT});console.log(`Brazi: servidor local na porta ${config.PORT}.`);
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close();});
}catch(error){console.error(error instanceof ConfigurationError?error.message:'Falha ao iniciar. Confira autenticação, origem HTTPS, disco persistente, versão do Node e porta; produção não inicia sem configuração segura.');process.exitCode=1;}
