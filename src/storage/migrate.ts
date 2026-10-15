import type {Pool,PoolClient} from 'pg';
import {StartupFailure} from '../startup-diagnostics.js';
import {initialMigration} from './migrations/001-initial.js';
export function schemaName(name:string){if(!/^[a-z][a-z0-9_]{0,62}$/.test(name)||name.startsWith('pg_')||['public','auth','storage','extensions','information_schema','graphql','graphql_public','realtime','supabase_functions','vault'].includes(name))throw new Error('Schema inválido.');return `"${name}"`;}
export async function migrate(pool:Pool,schema='brazi'){
 const name=schemaName(schema);let client:PoolClient;
 try{client=await pool.connect();}catch(error){throw new StartupFailure('database-connect',error);}
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[schema+':migration']);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${name}`);
  await client.query(`REVOKE ALL ON SCHEMA ${name} FROM PUBLIC`);
  await client.query(`SET LOCAL search_path TO ${name},pg_catalog`);
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied=await client.query('SELECT version FROM schema_migrations ORDER BY version');
  if(applied.rows.some(r=>r.version>1))throw Object.assign(new Error('Banco mais recente que esta versão da aplicação.'),{code:'BRAZI_DB_VERSION'});
  if(!applied.rows.some(r=>r.version===1)){
   await client.query(initialMigration);
   await client.query('INSERT INTO schema_migrations(version) VALUES(1)');
  }
  await client.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${name} FROM PUBLIC`);
  // Supabase possui esses papéis de API; PostgreSQL local pode não possuí-los.
  for(const role of ['anon','authenticated']){
   if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount){
    await client.query(`REVOKE ALL ON SCHEMA ${name} FROM ${role}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${name} FROM ${role}`);
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${name} FROM ${role}`);
   }
  }
  await client.query('COMMIT');
 }catch(error){try{await client.query('ROLLBACK');}catch{/* Preserve a falha original, sem imprimir detalhes. */}throw new StartupFailure('database-migrations',error);}finally{client.release();}
}
export async function transaction<T>(pool:Pool,work:(client:PoolClient)=>Promise<T>,readOnly=false):Promise<T>{
 const client=await pool.connect();
 try{await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');await client.query("SET LOCAL statement_timeout = '30s'");const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
