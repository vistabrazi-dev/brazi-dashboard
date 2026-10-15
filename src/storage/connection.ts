import {Pool,type PoolConfig} from 'pg';
import {DatabaseConfigurationError,hasCredentialPlaceholder} from './database-diagnostics.js';
export interface DatabaseOptions {production?:boolean;max?:number;ca?:string}
export function connectionOptions(connectionString:string,options:DatabaseOptions={}):PoolConfig {
 if(connectionString.trim()!==connectionString||/[\r\n\t]/.test(connectionString))throw new DatabaseConfigurationError('DB_URL_WHITESPACE');
 if(process.env.PGOPTIONS||process.env.PGREPLICATION)throw new DatabaseConfigurationError('DB_PG_OPTIONS_CONFLICT');
 let url:URL;
 try{url=new URL(connectionString);}catch{throw new Error('DATABASE_URL deve ser uma URL PostgreSQL válida.');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.pathname.slice(1)||url.hash)throw new Error('DATABASE_URL deve identificar usuário, host e banco PostgreSQL.');
 const port=Number(url.port||5432);if(!Number.isInteger(port)||port<1||port>65535)throw new DatabaseConfigurationError('DB_URL_PORT');
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 const mode=url.searchParams.get('sslmode');
 if(mode&&!['require','verify-full',...(!options.production&&local?['disable']:[])].includes(mode))throw new Error('DATABASE_URL exige TLS com verificação de certificado.');
 // Não deixe parâmetros da URL sobrescreverem a configuração TLS do driver.
 for(const key of url.searchParams.keys())if(key!=='sslmode')throw new Error('DATABASE_URL contém parâmetro não suportado. Use somente sslmode.');
 let user:string,password:string,database:string;
 try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);database=decodeURIComponent(url.pathname.slice(1));}catch{throw new DatabaseConfigurationError('DB_URL_ENCODING');}
 if(/[\0\r\n]/.test(user+password+database))throw new DatabaseConfigurationError('DB_URL_ENCODING');
 const pooler=url.hostname.endsWith('.pooler.supabase.com');
 if(pooler&&user==='postgres')throw new DatabaseConfigurationError('DB_POOLER_USER');
 if((pooler||options.production)&&!password)throw new DatabaseConfigurationError('DB_URL_PASSWORD_MISSING');
 if(pooler&&(hasCredentialPlaceholder(password)||/\[PROJECT[-_]REF\]/i.test(user)))throw new DatabaseConfigurationError('DB_URL_PLACEHOLDER');
 // Parse único: evita recodificação pelo pg-connection-string e defaults PG* implícitos.
 // A função (inclusive para senha vazia no teste local) impede fallback para PGPASSWORD/pgpass.
 return {host:url.hostname.replace(/^\[|\]$/g,''),port,user,password:()=>password,database,client_encoding:'UTF8',sslnegotiation:'postgres',ssl:!options.production&&local&&mode==='disable'?false:{rejectUnauthorized:true,...(options.ca?{ca:options.ca}:{})},max:options.max??3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,maxLifetimeSeconds:120,query_timeout:35000,application_name:'brazi-dashboard',allowExitOnIdle:true};
}
export function databasePool(url:string,options:DatabaseOptions={}){
 const pool=new Pool(connectionOptions(url,options));
 // Falhas de conexão ociosa não derrubam o processo nem imprimem detalhes de acesso.
 pool.on('error',()=>console.error('Conexão ociosa com PostgreSQL interrompida.'));
 return pool;
}
