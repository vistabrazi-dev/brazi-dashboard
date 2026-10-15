import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {connectionOptions} from '../src/storage/connection.js';
import {databaseDiagnostics,DatabaseConfigurationError} from '../src/storage/database-diagnostics.js';
import {startupDiagnostic} from '../src/startup-diagnostics.js';
test('parsing único preserva senha especial e ignora PGPORT, PGPASSWORD e demais defaults de conexão',async()=>{
 const vars={PGHOST:'wrong.example',PGPORT:'6543',PGUSER:'wrong',PGPASSWORD:'wrong',PGDATABASE:'wrong',PGSSLMODE:'no-verify',PGSSLNEGOTIATION:'direct'};
 const previous=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);
 try{
  const password='  ação@:/?#%25+🔐  ',url=`postgresql://postgres.example:${encodeURIComponent(password)}@aws-1-sa-east-1.pooler.supabase.com/postgres?sslmode=require`;
  const options=connectionOptions(url,{production:true});const client=new Client(options);
  const params=(client as unknown as {connectionParameters:{host:string;port:number;user:string;database:string;ssl:unknown;sslnegotiation:string}}).connectionParameters;
  assert.equal(params.port,5432);assert.equal(params.user,'postgres.example');assert.equal(params.database,'postgres');assert.equal(params.host,'aws-1-sa-east-1.pooler.supabase.com');assert.equal(params.sslnegotiation,'postgres');assert.deepEqual(params.ssl,{rejectUnauthorized:true});assert.equal(await (options.password as ()=>string)(),password);assert.equal(options.connectionString,undefined);
  await new Promise<void>(resolve=>(client as unknown as {_getPassword:(cb:()=>void)=>void})._getPassword(resolve));assert.equal((client as unknown as {password:string}).password,password);
  const local=connectionOptions('postgresql://local@127.0.0.1/local_test?sslmode=disable');assert.equal(await (local.password as ()=>string)(),'');
 }finally{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('pooler detecta usuário incompleto, senha ausente, placeholder e URL malformada com códigos seguros',()=>{
 const base='aws-1-sa-east-1.pooler.supabase.com';
 for(const [url,code] of [[`postgresql://postgres:fake@${base}/postgres`,'DB_POOLER_USER'],[`postgresql://postgres.ref@${base}/postgres`,'DB_URL_PASSWORD_MISSING'],[`postgresql://postgres.ref:${encodeURIComponent('[YOUR-PASSWORD]')}@${base}/postgres`,'DB_URL_PLACEHOLDER'],[`postgresql://postgres.ref:fake%ZZ@${base}/postgres`,'DB_URL_ENCODING'],[` postgresql://postgres.ref:fake@${base}/postgres`,'DB_URL_WHITESPACE']])assert.throws(()=>connectionOptions(url!),e=>e instanceof DatabaseConfigurationError&&e.code===code);
});
test('diagnóstico emite somente categorias fixas e nomes permitidos, nunca URL, senha ou referência',()=>{
 const url='postgresql://postgres.privateproject:privatepassword@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
 const output=databaseDiagnostics(url,{PGPASSWORD:'privatepassword',PGUSER:'postgres.privateproject',PGFAKE:'privatepassword'});
 assert.match(output,/modo=session/);assert.match(output,/postgres-com-sufixo/);assert.match(output,/senha=presente-na-url/);assert.match(output,/PGUSER,PGPASSWORD/);assert.doesNotMatch(output,/private|aws-1|postgresql:|PGFAKE/);
 for(const value of ['postgresql://private:secret%ZZ@host/db','private-secret','postgresql://private:secret@host/db'])assert.doesNotMatch(databaseDiagnostics(value,{}),/private|secret|host\/db/);
 assert.match(startupDiagnostic(new DatabaseConfigurationError('DB_POOLER_USER'),'configuration'),/DB_POOLER_USER/);
});

test('PGOPTIONS/PGREPLICATION são recusadas sem imprimir seus valores e porta zero não aciona PGPORT',()=>{
 for(const name of ['PGOPTIONS','PGREPLICATION']){const old=process.env[name];process.env[name]='private-adjustment';try{assert.throws(()=>connectionOptions('postgresql://user@127.0.0.1/test'),e=>e instanceof DatabaseConfigurationError&&e.code==='DB_PG_OPTIONS_CONFLICT');}finally{if(old===undefined)delete process.env[name];else process.env[name]=old;}}
 assert.throws(()=>connectionOptions('postgresql://user:fake@host:0/test'),e=>e instanceof DatabaseConfigurationError&&e.code==='DB_URL_PORT');
});
