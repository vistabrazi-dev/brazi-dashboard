import {config as loadEnvironment} from 'dotenv';
// Em produção, credenciais vêm exclusivamente do ambiente do processo.
if(process.env.NODE_ENV!=='production')loadEnvironment();
import {Store} from './storage/store.js';
try{
 const url=process.env.DATABASE_URL;if(!url)throw new Error();
 const store=await Store.open(url,{schema:process.env.DATABASE_SCHEMA??'brazi',production:process.env.NODE_ENV==='production',max:1,ca:process.env.DATABASE_CA_CERT});
 await store.close();console.log('Migrações PostgreSQL concluídas.');
}catch{console.error('Não foi possível migrar. Confira DATABASE_URL, TLS, acesso ao schema e conectividade.');process.exitCode=1;}
