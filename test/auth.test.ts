import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dashboardApp} from '../src/dashboard-app.js';
import {Store} from '../src/storage/store.js';
import {SyncService} from '../src/integration/sync.js';
import {passwordHash,verifyPassword,validPasswordHash} from '../src/auth/password.js';
import type {AuthOptions} from '../src/auth/auth.js';
import {settings} from '../src/settings.js';
const origin='https://brazi-test.example';
const headers={host:'render-internal:10000','x-forwarded-proto':'https',origin,'x-brazi-request':'1'};
async function fixture(file=':memory:'){
 const password=randomBytes(24).toString('hex');
 const config:AuthOptions={enabled:true,production:true,username:'test-user',passwordHash:await passwordHash(password),origin};
 const store=new Store(file),sync=new SyncService(store,undefined,'America/Sao_Paulo');
 const app=dashboardApp(store,sync,{timezone:'America/Sao_Paulo',tokenConfigured:false,auth:config,staticRoot:'/not-existing'});
 return {password,config,store,app,close:async()=>{await app.close();store.close();}};
}
function cookie(response:{headers:Record<string,unknown>}){const value=response.headers['set-cookie'];return String(Array.isArray(value)?value[value.length-1]:value).split(';')[0]!;}
test('hash salgado usa scrypt, verifica senha e não aceita hash/senha inválidos',async()=>{
 const value=randomBytes(24).toString('hex');const a=await passwordHash(value),b=await passwordHash(value);
 assert.notEqual(a,b);assert.ok(validPasswordHash(a));assert.equal(await verifyPassword(value,a),true);assert.equal(await verifyPassword(randomBytes(24).toString('hex'),a),false);assert.equal(await verifyPassword(value,'invalid'),false);await assert.rejects(passwordHash(''));
});
test('produção fecha sem credenciais, origem HTTPS ou caminho persistente e respeita PORT',async()=>{
 const hash=await passwordHash(randomBytes(24).toString('hex'));
 const valid={NODE_ENV:'production',AUTH_USERNAME:'test-user',AUTH_PASSWORD_HASH:hash,APP_ORIGIN:origin,DATABASE_PATH:'/tmp/brazi-production-test.sqlite',PORT:'10000'};
 const config=settings(valid);assert.equal(config.PORT,10000);assert.equal(config.host,'0.0.0.0');assert.equal(config.auth.enabled,true);
 for(const patch of [{AUTH_ENABLED:'false'},{AUTH_PASSWORD_HASH:''},{AUTH_USERNAME:''},{APP_ORIGIN:'http://example.com'},{APP_ORIGIN:origin+'/path'},{DATABASE_PATH:'.local/brazi.sqlite'},{APP_ORIGIN:undefined}])assert.throws(()=>settings({...valid,...patch}));
 assert.equal(settings({...valid,APP_ORIGIN:undefined,RENDER_EXTERNAL_URL:origin}).auth.origin,origin);
 assert.throws(()=>settings({...valid,RENDER:'true'}),/disco persistente/);
});
test('HTTPS é obrigatório, redirecionamento usa origem fixa, health não revela dados',async()=>{
 const f=await fixture();try{
  const redirect=await f.app.inject({url:'/',headers:{host:'untrusted.example'}});assert.equal(redirect.statusCode,308);assert.equal(redirect.headers.location,origin+'/');
  const http=await f.app.inject({url:'/api/auth/login',method:'POST',headers:{origin,'x-brazi-request':'1'},payload:{username:'test-user',password:f.password}});assert.equal(http.statusCode,426);assert.equal(http.headers['set-cookie'],undefined);
  const health=await f.app.inject('/health');assert.equal(health.statusCode,200);assert.deepEqual(health.json(),{status:'ok'});
  for(const url of ['/api/status','/api/dashboard?start=2026-10-01&end=2026-10-14','/api%2fstatus','/private']){
   const res=await f.app.inject({url,headers});assert.equal(res.statusCode,401);assert.equal(res.headers['cache-control'],'no-store');assert.ok(res.headers['strict-transport-security']);assert.doesNotMatch(res.body,/coverage|orders|products|RESERVA_INK_TOKEN/);
  }
 }finally{await f.close();}
});
test('login genérico, cookie Secure/HttpOnly/Strict, token armazenado só como hash e logout revoga',async()=>{
 const f=await fixture();try{
  const wrong=await f.app.inject({url:'/api/auth/login',method:'POST',headers,payload:{username:'test-user',password:randomBytes(24).toString('hex')}});assert.equal(wrong.statusCode,401);assert.equal(wrong.headers['set-cookie'],undefined);
  const login=await f.app.inject({url:'/api/auth/login',method:'POST',headers,payload:{username:'test-user',password:f.password}});assert.equal(login.statusCode,200);
  const raw=String(login.headers['set-cookie']);assert.match(raw,/__Host-brazi_session=/);assert.match(raw,/HttpOnly/);assert.match(raw,/Secure/);assert.match(raw,/SameSite=Strict/);assert.match(raw,/Path=\//);assert.doesNotMatch(raw,/Domain=/);
  const sessionCookie=cookie(login),token=sessionCookie.split('=')[1]!;
  const stored=f.store.db.prepare('SELECT token_hash FROM auth_sessions').get();assert.notEqual(stored?.token_hash,token);assert.equal(String(stored?.token_hash).length,64);
  const state=await f.app.inject({url:'/api/status',headers:{...headers,cookie:sessionCookie}});assert.equal(state.statusCode,200);
  const me=await f.app.inject({url:'/api/auth/session',headers:{...headers,cookie:sessionCookie}});assert.equal(me.json().authenticated,true);
  const logout=await f.app.inject({url:'/api/auth/logout',method:'POST',headers:{...headers,cookie:sessionCookie},payload:{}});assert.equal(logout.statusCode,200);assert.match(String(logout.headers['set-cookie']),/Max-Age=0/);
  assert.equal((await f.app.inject({url:'/api/status',headers:{...headers,cookie:sessionCookie}})).statusCode,401);
 }finally{await f.close();}
});
test('CSRF bloqueia login, logout e sync sem origem/cabeçalho corretos',async()=>{
 const f=await fixture();try{
  for(const path of ['/api/auth/login','/api/auth/logout','/api/sync'])for(const h of [{...headers,origin:'https://foreign.example'},{...headers,origin:undefined},{...headers,'x-brazi-request':undefined}]){
   const res=await f.app.inject({url:path,method:'POST',headers:Object.fromEntries(Object.entries(h).filter(([,value])=>value!==undefined)) as Record<string,string>,payload:{}});assert.equal(res.statusCode,403);
  }
  const res=await f.app.inject({url:'/api/sync',method:'POST',headers,payload:{}});assert.equal(res.statusCode,401);
 }finally{await f.close();}
});
test('login limita tentativas antes de verificar senha',async()=>{
 const f=await fixture();try{
  for(let i=0;i<10;i++)assert.equal((await f.app.inject({url:'/api/auth/login',method:'POST',headers,payload:{username:'test-user',password:randomBytes(24).toString('hex')}})).statusCode,401);
  const blocked=await f.app.inject({url:'/api/auth/login',method:'POST',headers,payload:{username:'test-user',password:f.password}});assert.equal(blocked.statusCode,429);assert.ok(Number(blocked.headers['retry-after'])>0);
 }finally{await f.close();}
});
test('sessão expirada ou token forjado não autentica e login novo gira o token anterior',async()=>{
 const f=await fixture();try{
  const request={url:'/api/auth/login',method:'POST' as const,headers,payload:{username:'test-user',password:f.password}};
  const first=await f.app.inject(request),old=cookie(first);
  const next=await f.app.inject({...request,headers:{...headers,cookie:old}});assert.notEqual(cookie(next),old);
  assert.equal((await f.app.inject({url:'/api/status',headers:{...headers,cookie:old}})).statusCode,401);
  assert.equal((await f.app.inject({url:'/api/status',headers:{...headers,cookie:`__Host-brazi_session=${randomBytes(32).toString('base64url')}`}})).statusCode,401);
  f.store.db.exec('UPDATE auth_sessions SET expires_at=0');assert.equal((await f.app.inject({url:'/api/status',headers:{...headers,cookie:cookie(next)}})).statusCode,401);
 }finally{await f.close();}
});
test('sessões sobrevivem ao restart com disco e são revogadas ao trocar credencial',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'brazi-auth-')),path=join(dir,'db.sqlite'),f=await fixture(path);const config=f.config;
 const login=await f.app.inject({url:'/api/auth/login',method:'POST',headers,payload:{username:config.username,password:f.password}});const saved=cookie(login);await f.close();
 const store=new Store(path);let app=dashboardApp(store,new SyncService(store,undefined,'America/Sao_Paulo'),{timezone:'America/Sao_Paulo',tokenConfigured:false,auth:config,staticRoot:'/none'});
 try{
  assert.equal((await app.inject({url:'/api/status',headers:{...headers,cookie:saved}})).statusCode,200);await app.close();
  app=dashboardApp(store,new SyncService(store,undefined,'America/Sao_Paulo'),{timezone:'America/Sao_Paulo',tokenConfigured:false,auth:{...config,passwordHash:await passwordHash(randomBytes(24).toString('hex'))},staticRoot:'/none'});
  assert.equal((await app.inject({url:'/api/status',headers:{...headers,cookie:saved}})).statusCode,401);
 }finally{await app.close();store.close();rmSync(dir,{recursive:true});}
});

test('operações autenticadas rejeitam corpo não JSON antes de alterar estado',async()=>{
 const f=await fixture();try{
  for(const url of ['/api/auth/login','/api/auth/logout','/api/sync']){
   const response=await f.app.inject({url,method:'POST',headers:{...headers,'content-type':'text/plain'},payload:'not-json'});assert.equal(response.statusCode,415);
  }
 }finally{await f.close();}
});
