import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startupDiagnostic,StartupFailure} from '../src/startup-diagnostics.js';
import {migrate} from '../src/storage/migrate.js';
import type {Pool} from 'pg';
const privateText='postgresql://private-user:private-password@private-host/private-db private-hash private-token';
test('diagnóstico distingue DNS, rede, TLS, credencial, permissões e porta sem conteúdo privado',()=>{
 for(const [code,expected] of [['ENOTFOUND','DNS'],['ENETUNREACH','IPv4'],['SELF_SIGNED_CERT_IN_CHAIN','TLS'],['28P01','Autenticação'],['42501','Permissão'],['53300','conexões'],['57P03','pausado'],['EADDRINUSE','Porta']]){
  const error=Object.assign(new Error(privateText),{code,detail:privateText,hint:privateText,stack:privateText});const message=startupDiagnostic(error,'database-connect');assert.match(message,new RegExp(expected!));assert.doesNotMatch(message,/private-|postgresql:\/\//);
 }
});
test('erros desconhecidos e causas aninhadas não são serializados; código arbitrário não é impresso',()=>{
 for(const error of [privateText,{code:privateText,message:privateText},{cause:{message:privateText}},new Error(privateText)])assert.doesNotMatch(startupDiagnostic(error,'application'),/private-|postgresql:\/\//);
 const error=new StartupFailure('database-migrations',new AggregateError([Object.assign(new Error(privateText),{code:'42501'})],privateText));assert.match(startupDiagnostic(error,'database-connect'),/etapa=migrações PostgreSQL; diagnóstico=42501/);
 const cycle:{cause?:unknown}={};cycle.cause=cycle;assert.match(startupDiagnostic(cycle,'runtime'),/NAO_CLASSIFICADO/);
 assert.match(startupDiagnostic(new Error('Connection terminated due to connection timeout'),'database-connect'),/ETIMEDOUT/);
});
test('migração identifica falha de conexão e falha SQL preservando o erro original apenas como causa',async()=>{
 const cause=Object.assign(new Error(privateText),{code:'28P01'});
 await assert.rejects(migrate({connect:async()=>{throw cause;}} as unknown as Pool),error=>error instanceof StartupFailure&&error.stage==='database-connect'&&error.cause===cause);
 const sql=Object.assign(new Error(privateText),{code:'42501'});let released=false,rollback=false;
 const client={query:async(text:string)=>{if(text==='ROLLBACK'){rollback=true;throw new Error('rollback '+privateText);}if(text.startsWith('CREATE SCHEMA'))throw sql;return {rows:[],rowCount:0};},release:()=>{released=true;}};
 await assert.rejects(migrate({connect:async()=>client} as unknown as Pool),error=>error instanceof StartupFailure&&error.stage==='database-migrations'&&error.cause===sql);
 assert.ok(rollback);assert.ok(released);
});
