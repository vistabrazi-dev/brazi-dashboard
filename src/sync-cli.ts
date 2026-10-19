import {assertInkAllowed} from './staging-guard.js';
import {settings} from './settings.js';
import {configureProxy} from './integration/transport.js';
import {Store} from './storage/store.js';
import {SyncService} from './integration/sync.js';
let store:Store|undefined,sync:SyncService|undefined;
try{
 assertInkAllowed();const config=settings();configureProxy();process.umask(0o077);
 store=await Store.open(config.DATABASE_URL,{schema:config.DATABASE_SCHEMA,production:config.production,max:config.DATABASE_POOL_MAX,ca:config.DATABASE_CA_CERT});
 sync=new SyncService(store,config.RESERVA_INK_TOKEN,config.BUSINESS_TIMEZONE,config.API_PAUSE_MS,config.SYNC_MAX_PAGES);
 const started=await sync.start();
 if(!started.accepted){console.error(started.reason);process.exitCode=1;}else{
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void sync?.stop();});
  let last='';
  while(true){const state=await store.status(),text=JSON.stringify(state.run);if(text!==last){console.log(text);last=text;}if(state.run?.status!=='running'){process.exitCode=state.run?.status==='success'?0:1;break;}await new Promise(resolve=>setTimeout(resolve,10000));}
 }
}catch{console.error('Sincronização não concluída. Confira PostgreSQL, TLS e configuração privada do backend.');process.exitCode=1;}finally{await sync?.stop();await store?.close();}
