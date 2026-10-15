import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {parse,serialize} from 'cookie';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {z} from 'zod';
import {Store} from '../storage/store.js';
import {validPasswordHash,verifyPassword} from './password.js';
export interface AuthOptions {enabled:boolean;production:boolean;username?:string;passwordHash?:string;origin?:string;ttlSeconds?:number}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const pathOf=(request:FastifyRequest)=>request.url.split('?')[0]??'/';
export function sameOrigin(request:FastifyRequest,origin?:string):boolean{
 const raw=request.headers.origin;if(!raw)return false;
 try {
  const url=new URL(raw);if(url.origin!==raw)return false;
  if(origin)return raw===origin;
  return url.protocol==='http:'&&url.host===request.headers.host&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 }catch{return false;}
}
export function installAuth(app:FastifyInstance,store:Store,config:AuthOptions){
 if(config.production&&(!config.enabled||!config.origin?.startsWith('https://')))throw new Error('Produção exige autenticação e origem HTTPS.');
 if(config.enabled&&(!config.username||!config.passwordHash||!validPasswordHash(config.passwordHash)))throw new Error('Configure usuário e hash de senha válidos.');
 const cookieName=config.production?'__Host-brazi_session':'brazi_session';
 const ttl=config.ttlSeconds??28800;
 const credentialTag=digest(`${config.username??''}\0${config.passwordHash??''}`);
 store.db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,credential_tag TEXT NOT NULL,expires_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
  CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);`);
 if(config.enabled)store.db.prepare('DELETE FROM auth_sessions WHERE credential_tag<>? OR expires_at<=?').run(credentialTag,Date.now());
 const getToken=(request:FastifyRequest)=>{try{const token=parse(request.headers.cookie??'')[cookieName];return token&&/^[A-Za-z0-9_-]{43}$/.test(token)?token:null;}catch{return null;}};
 const authenticated=(request:FastifyRequest)=>{
  if(!config.enabled)return true;const token=getToken(request);if(!token)return false;
  return Boolean(store.db.prepare('SELECT token_hash FROM auth_sessions WHERE token_hash=? AND credential_tag=? AND expires_at>?').get(digest(token),credentialTag,Date.now()));
 };
 const cookie=(token:string,maxAge:number)=>serialize(cookieName,token,{httpOnly:true,secure:config.production,sameSite:'strict',path:'/',maxAge});
 const forget=(request:FastifyRequest,reply:FastifyReply)=>{const token=getToken(request);if(token)store.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(token));reply.header('Set-Cookie',cookie('',0));};
 const mutationAllowed=(request:FastifyRequest)=>request.headers['x-brazi-request']==='1'&&sameOrigin(request,config.origin);
 const consume=(request:FastifyRequest)=>{
  const now=Date.now(),window=15*60*1000;
  const limits=[{key:'ip:'+digest(request.ip+credentialTag),maximum:10},{key:'global',maximum:60}];
  store.db.exec('BEGIN IMMEDIATE');
  try{
   store.db.prepare('DELETE FROM auth_attempts WHERE reset_at<=?').run(now);
   for(const limit of limits){const row=store.db.prepare('SELECT count,reset_at FROM auth_attempts WHERE key=?').get(limit.key);if(row&&Number(row.count)>=limit.maximum){store.db.exec('COMMIT');return Math.max(1,Math.ceil((Number(row.reset_at)-now)/1000));}}
   for(const limit of limits)store.db.prepare('INSERT INTO auth_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(limit.key,now+window);
   store.db.exec('COMMIT');return 0;
  }catch(error){store.db.exec('ROLLBACK');throw error;}
 };
 app.addHook('onRequest',async(request,reply)=>{
  const path=pathOf(request),read=['GET','HEAD'].includes(request.method);
  if(config.production&&request.protocol!=='https'&&!(read&&path==='/health')){
   if(read){const target=request.url.startsWith('/')&&!request.url.startsWith('//')?request.url:'/';return reply.code(308).header('Location',config.origin+target).send();}
   return reply.code(426).send({error:'HTTPS obrigatório.'});
  }
  if(!config.enabled)return;
  if(!read&&request.method!=='OPTIONS'){
   if(!mutationAllowed(request))return reply.code(403).send({error:'Origem ou cabeçalho de segurança inválido.'});
   if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))return reply.code(415).send({error:'Envie JSON para esta operação.'});
  }
  const publicRead=read&&['/health','/','/login','/index.html','/favicon.svg','/api/auth/session'].includes(path);
  const asset=read&&/^\/assets\/[A-Za-z0-9_-]+\.(js|css|woff2|svg|png)$/.test(path);
  if(publicRead||asset||(request.method==='POST'&&path==='/api/auth/login'))return;
  if(!authenticated(request))return reply.code(401).send({error:'Autenticação necessária.'});
 });
 app.get('/api/auth/session',async(request)=>{
  const yes=authenticated(request);
  return {enabled:config.enabled,authenticated:yes,...(config.enabled&&yes?{username:config.username}:{})};
 });
 app.post('/api/auth/login',async(request,reply)=>{
  if(!config.enabled)return reply.code(404).send({error:'Login não habilitado neste ambiente.'});
  const retry=consume(request);if(retry)return reply.code(429).header('Retry-After',retry).send({error:'Muitas tentativas. Aguarde antes de tentar novamente.'});
  const parsed=z.object({username:z.string().min(1).max(128),password:z.string().min(1).max(256)}).strict().safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({error:'Informe usuário e senha válidos.'});
  const userMatches=timingSafeEqual(Buffer.from(digest(parsed.data.username),'hex'),Buffer.from(digest(config.username!),'hex'));
  const passwordMatches=await verifyPassword(parsed.data.password,config.passwordHash!);
  if(!userMatches||!passwordMatches)return reply.code(401).send({error:'Usuário ou senha inválidos.'});
  const previousToken=getToken(request);if(previousToken)store.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(previousToken));
  store.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(Date.now());
  const token=randomBytes(32).toString('base64url');
  store.db.prepare('INSERT INTO auth_sessions(token_hash,credential_tag,expires_at) VALUES(?,?,?)').run(digest(token),credentialTag,Date.now()+ttl*1000);
  reply.header('Set-Cookie',cookie(token,ttl));return {authenticated:true,username:config.username};
 });
 app.post('/api/auth/logout',async(request,reply)=>{forget(request,reply);return {authenticated:false};});
}
