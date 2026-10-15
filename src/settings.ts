import 'dotenv/config';
import {isAbsolute,resolve,sep} from 'node:path';
import {existsSync,statSync} from 'node:fs';
import {z} from 'zod';
import {validPasswordHash} from './auth/password.js';
export class ConfigurationError extends Error {}
const schema=z.object({
 NODE_ENV:z.enum(['development','test','production']).default('development'),
 RESERVA_INK_TOKEN:z.string().trim().min(1).refine(s=>! /\s/.test(s)).optional(),
 PORT:z.coerce.number().int().min(1).max(65535).default(3000),
 DATABASE_PATH:z.string().min(1).default('.local/brazi.sqlite'),
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
 const clean={...environment};for(const key of ['RESERVA_INK_TOKEN','DISPLAY_CURRENCY','AUTH_USERNAME','AUTH_PASSWORD_HASH','APP_ORIGIN','RENDER_EXTERNAL_URL','AUTH_ENABLED'])if(!clean[key])delete clean[key];
 const result=schema.safeParse(clean);if(!result.success)throw new ConfigurationError('Configuração inválida. Confira as variáveis do backend.');
 const config=result.data,production=config.NODE_ENV==='production';
 const enabled=config.AUTH_ENABLED===undefined?production:config.AUTH_ENABLED==='true';
 const sourceOrigin=config.APP_ORIGIN||config.RENDER_EXTERNAL_URL;
 let origin:string|undefined;
 if(sourceOrigin){try{const url=new URL(sourceOrigin);if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new ConfigurationError();if(production?url.protocol!=='https:':!['http:','https:'].includes(url.protocol))throw new ConfigurationError();origin=url.origin;}catch{throw new ConfigurationError('APP_ORIGIN deve ser uma origem válida, HTTPS em produção.');}}
 if(production&&(!enabled||!origin))throw new ConfigurationError('Produção exige autenticação e APP_ORIGIN ou RENDER_EXTERNAL_URL HTTPS.');
 if(enabled&&(!config.AUTH_USERNAME||!config.AUTH_PASSWORD_HASH||!validPasswordHash(config.AUTH_PASSWORD_HASH)))throw new ConfigurationError('Configure AUTH_USERNAME e AUTH_PASSWORD_HASH válidos.');
 if(production&&!isAbsolute(config.DATABASE_PATH))throw new ConfigurationError('Produção exige DATABASE_PATH absoluto para armazenamento persistente.');
 if(config.RENDER==='true'){
  if(!production)throw new ConfigurationError('Render exige NODE_ENV=production.');
  const path=resolve(config.DATABASE_PATH);
  if(!path.startsWith('/var/data'+sep)||!existsSync('/var/data')||!statSync('/var/data').isDirectory())throw new ConfigurationError('Render exige disco persistente montado em /var/data e DATABASE_PATH dentro dele.');
 }
 new Intl.DateTimeFormat('pt-BR',{timeZone:config.BUSINESS_TIMEZONE});
 if(config.DISPLAY_CURRENCY)new Intl.NumberFormat('pt-BR',{style:'currency',currency:config.DISPLAY_CURRENCY});
 return {...config,production,host:production?'0.0.0.0':'127.0.0.1',auth:{enabled,production,username:config.AUTH_USERNAME,passwordHash:config.AUTH_PASSWORD_HASH,origin}};
}
