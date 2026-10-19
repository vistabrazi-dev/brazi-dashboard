// Não carrega dotenv: URLs e política são explícitas, sem fallback para DATABASE_URL.
import {readFile} from 'node:fs/promises';
import {loadPolicy,preflight,verifyIdentity} from './staging/preflight.js';
import {databasePool} from './storage/connection.js';
import {migrate} from './storage/migrate.js';
import {exportSnapshot,importSnapshot,parseExact,canonical,validatePacket} from './staging/snapshot.js';
import {createKey,readKey,writeEncrypted,readEncrypted} from './staging/files.js';
const required=(key:string)=>{const value=process.env[key];if(!value)throw new Error();return value;};
try{
 process.umask(0o077);
 if(required('BRAZI_ENV')!=='staging')throw new Error();
 const action=process.argv[2],options={production:process.env.NODE_ENV==='production',ca:process.env.DATABASE_CA_CERT,max:1};
 if(action==='key'){await createKey(required('STAGING_KEY_PATH'));console.log('Chave local privada criada; não compartilhar nem versionar.');}
 else{
  const policy=await loadPolicy();
  if(action==='export'){
   const packet=await exportSnapshot(required('STAGING_SOURCE_URL'),required('STAGING_SOURCE_SCHEMA'),{...options,codeRevision:required('STAGING_CODE_REVISION')},policy,JSON.parse(await readFile(required('STAGING_SOURCE_COUNTS_PATH'),'utf8')));
   await writeEncrypted(required('STAGING_SNAPSHOT_PATH'),canonical(packet),await readKey(required('STAGING_KEY_PATH')));
   console.log('Snapshot criptografado criado. SHA-256 para conferência privada: '+packet.sha256);
  }else{
   const url=required('STAGING_DESTINATION_URL'),schema=policy.schema;
   await preflight(url,schema,options,policy);
   if(action==='preflight')console.log('Preflight staging aprovado; nenhuma migração executada.');
   else if(action==='migrate'){
    const pool=databasePool(url,options);try{await migrate(pool,schema,c=>verifyIdentity(c,policy));}finally{await pool.end();}
    console.log('Migrações concluídas exclusivamente no destino validado.');
   }else if(action==='import'){
    const packet=parseExact(await readEncrypted(required('STAGING_SNAPSHOT_PATH'),await readKey(required('STAGING_KEY_PATH'))));
    const hash=required('STAGING_EXPECTED_SHA256');
    if(validatePacket(packet,hash).codeRevision!==required('STAGING_CODE_REVISION'))throw new Error();
    await importSnapshot(url,schema,packet,hash,policy,options);
    console.log('Carga atômica reconciliada e persistência verificada.');
   }else throw new Error();
  }
 }
}catch{
 // Nunca serializa exceções pg/zod: podem conter SQL, registros ou credenciais.
 console.error('Operação staging recusada ou não concluída. Confira ação, política, identidade, TLS, pacote e destino vazio. Nenhum detalhe sensível foi registrado.');process.exitCode=1;
}
