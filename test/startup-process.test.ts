import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {testStore,testUrl,destroy} from './helpers/database.js';
async function boot(patch:NodeJS.ProcessEnv){
 const env={...process.env,NODE_ENV:'test',AUTH_ENABLED:'false',RESERVA_INK_TOKEN:'',DATABASE_URL:'',...patch};
 const child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),resolve('src/server.ts')],{env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
 try{const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});return {code,output};}finally{clearTimeout(timer);}
}
test('processo de startup falha com etapa segura, código não zero e sem valores privados',async t=>{
 await t.test('configuração informa o nome da variável ausente',async()=>{
  const result=await boot({DATABASE_URL:'',RESERVA_INK_TOKEN:'private-invalid token'});assert.equal(result.code,1);assert.match(result.output,/etapa=configuração/);assert.match(result.output,/DATABASE_URL/);assert.doesNotMatch(result.output,/private-invalid/);
 });
 await t.test('conexão real recusada tem classificação e não vaza URL ou senha',async()=>{
  const guard=createServer();await new Promise<void>(resolve=>guard.listen(0,'127.0.0.1',resolve));const port=(guard.address() as {port:number}).port;await new Promise<void>(resolve=>guard.close(()=>resolve()));
  const result=await boot({DATABASE_URL:`postgresql://private-user:private-password@127.0.0.1:${port}/private-db?sslmode=disable`});assert.equal(result.code,1);assert.match(result.output,/etapa=conexão PostgreSQL; diagnóstico=ECONNREFUSED/);assert.doesNotMatch(result.output,/private-|postgresql:\/\//);
 });
 await t.test('porta ocupada é identificada após migrações reais e encerra o pool',async()=>{
  const store=await testStore(),guard=createServer();
  try{
   await new Promise<void>(resolve=>guard.listen(0,'127.0.0.1',resolve));const port=(guard.address() as {port:number}).port;
   const result=await boot({DATABASE_URL:testUrl(),DATABASE_SCHEMA:store.schema,PORT:String(port)});assert.equal(result.code,1);assert.match(result.output,/etapa=abertura da porta HTTP; diagnóstico=EADDRINUSE/);assert.doesNotMatch(result.output,/postgresql:\/\/|Error:| at /);
  }finally{await new Promise<void>(resolve=>guard.close(()=>resolve()));await destroy(store);}
 });
});
