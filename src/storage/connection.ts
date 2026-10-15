import {Pool,type PoolConfig} from 'pg';
export interface DatabaseOptions {production?:boolean;max?:number;ca?:string}
export function connectionOptions(connectionString:string,options:DatabaseOptions={}):PoolConfig {
 let url:URL;
 try{url=new URL(connectionString);}catch{throw new Error('DATABASE_URL deve ser uma URL PostgreSQL válida.');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.pathname.slice(1)||url.hash)throw new Error('DATABASE_URL deve identificar usuário, host e banco PostgreSQL.');
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 const mode=url.searchParams.get('sslmode');
 if(mode&&!['require','verify-full',...(!options.production&&local?['disable']:[])].includes(mode))throw new Error('DATABASE_URL exige TLS com verificação de certificado.');
 // Não deixe parâmetros da URL sobrescreverem a configuração TLS do driver.
 for(const key of url.searchParams.keys())if(key!=='sslmode')throw new Error('DATABASE_URL contém parâmetro não suportado. Use somente sslmode.');
 url.search='';
 return {connectionString:url.toString(),ssl:!options.production&&local&&mode==='disable'?false:{rejectUnauthorized:true,...(options.ca?{ca:options.ca}:{})},max:options.max??3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,maxLifetimeSeconds:120,query_timeout:35000,application_name:'brazi-dashboard',allowExitOnIdle:true};
}
export function databasePool(url:string,options:DatabaseOptions={}){
 const pool=new Pool(connectionOptions(url,options));
 // Falhas de conexão ociosa não derrubam o processo nem imprimem detalhes de acesso.
 pool.on('error',()=>console.error('Conexão ociosa com PostgreSQL interrompida.'));
 return pool;
}
