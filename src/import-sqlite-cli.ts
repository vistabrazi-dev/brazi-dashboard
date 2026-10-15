import {settings} from './settings.js';
import {Store} from './storage/store.js';
import {importSqlite} from './storage/import-sqlite.js';
let store:Store|undefined;
try{
 const config=settings(),path=process.env.SQLITE_IMPORT_PATH;if(!path)throw new Error();
 store=await Store.open(config.DATABASE_URL,{schema:config.DATABASE_SCHEMA,production:config.production,max:config.DATABASE_POOL_MAX,ca:config.DATABASE_CA_CERT});
 await importSqlite(store,path);console.log('Importação comercial concluída. Sessões antigas não foram copiadas.');
}catch{console.error('Importação recusada ou não concluída. Confira origem SQLite privada, destino PostgreSQL vazio, TLS e configuração.');process.exitCode=1;}finally{await store?.close();}
