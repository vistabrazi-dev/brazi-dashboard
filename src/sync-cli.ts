import {settings} from './settings.js';
import {configureProxy} from './integration/transport.js';
import {Store} from './storage/store.js';
import {SyncService} from './integration/sync.js';
const config=settings();configureProxy();process.umask(0o077);
const store=new Store(config.DATABASE_PATH),sync=new SyncService(store,config.RESERVA_INK_TOKEN,config.BUSINESS_TIMEZONE,config.API_PAUSE_MS,config.SYNC_MAX_PAGES);
const started=sync.start();
if(!started.accepted){console.error(started.reason);store.close();process.exitCode=1;}else{
 let last='';const timer=setInterval(()=>{const state=store.status();const text=JSON.stringify(state.run);if(text!==last){console.log(text);last=text;}if(state.run?.status!=='running'){clearInterval(timer);process.exitCode=state.run?.status==='success'?0:1;store.close();}},10000);
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void sync.stop();});
}
