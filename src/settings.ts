import {stagingMode} from './staging-guard.js';
import {config as loadEnvironment} from 'dotenv';
// Em produção, credenciais vêm exclusivamente do ambiente do processo.
if(process.env.NODE_ENV!=='production')loadEnvironment();
import {schemaName} from './storage/migrate.js';
import {connectionOptions} from './storage/connection.js';
import {DatabaseConfigurationError} from './storage/database-diagnostics.js';
import {z} from 'zod';
import {validPasswordHash} from './auth/password.js';
export class ConfigurationError extends Error {}
const schema=z.object({
 NODE_ENV:z.enum(['development','test','production']).default('development'),
 RESERVA_INK_TOKEN:z.string().trim().min(1).refine(s=>! /\s/.test(s)).optional(),
 PORT:z.coerce.number().int().min(1).max(65535).default(3000),
 DATABASE_URL:z.string().min(1),
 DATABASE_SCHEMA:z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).default('brazi'),
 DATABASE_POOL_MAX:z.coerce.number().int().min(1).max(5).default(3),
 DATABASE_CA_CERT:z.string().optional(),
 BUSINESS_TIMEZONE:z.string().default('America/Sao_Paulo'),
 API_PAUSE_MS:z.coerce.number().int().min(1500).max(30000).default(1800),
 SYNC_MAX_PAGES:z.coerce.number().int().min(1).max(10000).default(1000),
 DISPLAY_CURRENCY:z.string().length(3).optional(),
 AUTH_ENABLED:z.enum(['true','false']).optional(),
 AUTH_USERNAME:z.string().min(1).max(128).optional(),
 AUTH_PASSWORD_HASH:z.string().optional(),
 APP_ORIGIN:z.string().optional(),
 RENDER_EXTERNAL_URL:z.string().optional(),
 RENDER:z.string().optional(),
});
export function settings(environment:NodeJS.ProcessEnv=process.env){
 stagingMode(environment);const clean={...environment};for(const key of ['RESERVA_INK_TOKEN','DISPLAY_CURRENCY','AUTH_USERNAME','AUTH_PASSWORD_HASH','APP_ORIGIN','RENDER_EXTERNAL_URL','AUTH_ENABLED'])if(!clean[key])delete clean[key];
 const result=schema.safeParse(clean);if(!result.success){const fields=[...new Set(result.error.issues.map(issue=>issue.path[0]).filter((key):key is string=>typeof key==='string'&&Object.hasOwn(schema.shape,key)))];throw new ConfigurationError('Variáveis ausentes ou inválidas: '+fields.join(', ')+'.');}
 const config=result.data,production=config.NODE_ENV==='production';
 const enabled=config.AUTH_ENABLED===undefined?production:config.AUTH_ENABLED==='true';
 const sourceOrigin=config.APP_ORIGIN||config.RENDER_EXTERNAL_URL;
 let origin:string|undefined;
 if(sourceOrigin){try{const url=new URL(sourceOrigin);if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new ConfigurationError();if(production?url.protocol!=='https:':!['http:','https:'].includes(url.protocol))throw new ConfigurationError();origin=url.origin;}catch{throw new ConfigurationError('APP_ORIGIN deve ser uma origem válida, HTTPS em produção.');}}
 if(production&&(!enabled||!origin))throw new ConfigurationError('Produção exige autenticação e APP_ORIGIN ou RENDER_EXTERNAL_URL HTTPS.');
 if(enabled&&(!config.AUTH_USERNAME||!config.AUTH_PASSWORD_HASH||!validPasswordHash(config.AUTH_PASSWORD_HASH)))throw new ConfigurationError('Configure AUTH_USERNAME e AUTH_PASSWORD_HASH válidos.');
 try{schemaName(config.DATABASE_SCHEMA);connectionOptions(config.DATABASE_URL,{production,max:config.DATABASE_POOL_MAX,ca:config.DATABASE_CA_CERT});}catch(error){if(error instanceof DatabaseConfigurationError)throw error;throw new ConfigurationError('DATABASE_URL inválida ou TLS inseguro. Confira a conexão PostgreSQL.');}
 if(config.RENDER==='true'&&!production)throw new ConfigurationError('Render exige NODE_ENV=production.');
 try{new Intl.DateTimeFormat('pt-BR',{timeZone:config.BUSINESS_TIMEZONE});}catch{throw new ConfigurationError('BUSINESS_TIMEZONE inválido. Use um identificador de fuso IANA.');}
 if(config.DISPLAY_CURRENCY)try{new Intl.NumberFormat('pt-BR',{style:'currency',currency:config.DISPLAY_CURRENCY});}catch{throw new ConfigurationError('DISPLAY_CURRENCY inválida. Confira o código de moeda.');}
 return {...config,production,host:production?'0.0.0.0':'127.0.0.1',auth:{enabled,production,username:config.AUTH_USERNAME,passwordHash:config.AUTH_PASSWORD_HASH,origin}};
}
