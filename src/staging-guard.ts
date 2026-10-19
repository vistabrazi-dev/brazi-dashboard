// Avaliado também no ponto de chamada: cadastrar um token não libera staging.
export function stagingMode(env:NodeJS.ProcessEnv=process.env){
 if(env.BRAZI_ENV!==undefined&&!['production','development','test','staging'].includes(env.BRAZI_ENV))throw new Error('BRAZI_ENV inválido.');
 if(env.INK_SYNC_DISABLED!==undefined&&!['true','false'].includes(env.INK_SYNC_DISABLED))throw new Error('INK_SYNC_DISABLED inválido.');
 return env.BRAZI_ENV==='staging'||Boolean(env.STAGING_POLICY_PATH);
}
export function assertInkAllowed(env:NodeJS.ProcessEnv=process.env){
 if(stagingMode(env)||env.INK_SYNC_DISABLED==='true')throw new Error('Sincronização INK bloqueada por política do ambiente.');
}
