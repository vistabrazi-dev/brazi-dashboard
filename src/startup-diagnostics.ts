// Saída estritamente construída de constantes. Nunca serialize o erro original.
export type StartupStage='runtime'|'configuration'|'database-connect'|'database-migrations'|'application'|'http-listen';
export class StartupFailure extends Error {
 constructor(readonly stage:StartupStage,cause:unknown){super('Inicialização interrompida.',{cause});}
}
const stages:Record<StartupStage,string>={runtime:'runtime',configuration:'configuração', 'database-connect':'conexão PostgreSQL','database-migrations':'migrações PostgreSQL',application:'preparação HTTP','http-listen':'abertura da porta HTTP'};
const reasons:Record<string,string>={
 DB_URL_PORT:'Porta inválida em DATABASE_URL. Use a porta exibida em Connect; Session Pooler normalmente usa 5432.',
 DB_URL_WHITESPACE:'DATABASE_URL contém espaços externos ou quebras de linha. Cole somente a URI, sem aspas ou prefixo DATABASE_URL=.',
 DB_URL_ENCODING:'Codificação percentual inválida em DATABASE_URL. Codifique usuário/senha uma única vez, sem alterar o valor original.',
 DB_PG_OPTIONS_CONFLICT:'Remova PGOPTIONS e PGREPLICATION: esses ajustes de sessão não são suportados nesta aplicação.',
 DB_POOLER_USER:'Session Pooler exige o usuário completo exibido em Connect, normalmente postgres.<project-ref>; não use apenas postgres retornado pelo SQL Editor.',
 DB_URL_PASSWORD_MISSING:'Senha ausente em DATABASE_URL. Use a senha do banco Supabase; PGPASSWORD não é usado como substituto.',
 DB_URL_PLACEHOLDER:'Possível placeholder na conexão do pooler. Substitua os marcadores pela credencial do banco no painel privado.',

 ENOTFOUND:'DNS do banco não resolvido. Confira o hostname do Session Pooler.',EAI_AGAIN:'DNS indisponível temporariamente. Confira a rede e tente novamente.',
 ECONNREFUSED:'Conexão recusada. Confira o pooler, a porta e o estado do projeto Supabase.',ECONNRESET:'Conexão interrompida. Confira a rede e o estado do pooler.',ETIMEDOUT:'Tempo de conexão esgotado. Confira rede, restrições de acesso e suspensão do Supabase.',ENETUNREACH:'Rede do banco inacessível. Prefira o Session Pooler compatível com IPv4.',EHOSTUNREACH:'Host do banco inacessível. Confira a conectividade ao Session Pooler.',EPIPE:'Conexão com o banco interrompida.',
 DEPTH_ZERO_SELF_SIGNED_CERT:'Certificado TLS não confiável. Configure a CA oficial em DATABASE_CA_CERT; não desative a verificação.',SELF_SIGNED_CERT_IN_CHAIN:'Cadeia TLS não confiável. Configure a CA oficial em DATABASE_CA_CERT; não desative a verificação.',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'Não foi possível verificar a cadeia TLS. Confira a CA oficial do banco.',UNABLE_TO_GET_ISSUER_CERT_LOCALLY:'CA emissora não reconhecida. Confira DATABASE_CA_CERT.',CERT_HAS_EXPIRED:'Certificado TLS expirado. Confira a cadeia oficial do banco.',ERR_TLS_CERT_ALTNAME_INVALID:'Certificado TLS não corresponde ao hostname. Use o endereço exato do pooler.',
 '28P01':'Autenticação PostgreSQL recusada. Confira usuário do pooler e senha em DATABASE_URL; codifique caracteres reservados na URL.', '28000':'Autorização PostgreSQL recusada. Confira a credencial e as restrições do banco.', '3D000':'Banco de destino inexistente. Confira o nome do banco na configuração privada.', '42501':'Permissão insuficiente para schema ou migrações. Use o proprietário do schema e confira os grants.', '53300':'Limite de conexões atingido. Reduza o pool e feche conexões ociosas.', '57P03':'PostgreSQL temporariamente indisponível. Confira se o projeto está pausado ou retomando.', '57014':'Operação PostgreSQL excedeu o tempo permitido ou foi cancelada. Confira concorrência e disponibilidade.', '42P07':'Estrutura existente incompatível com a migração. Confira schema e histórico de versões; não apague dados.', '42P01':'Tabela esperada ausente. Confira schema e histórico de migrações.', 'XX000':'O pooler ou banco retornou erro interno. Confira projeto ativo, usuário do Session Pooler e endpoint no painel Supabase.',
 EADDRINUSE:'Porta HTTP já está em uso. Confira PORT e processos concorrentes.',EACCES:'Permissão negada ao abrir a porta HTTP. Confira PORT.',BRAZI_DB_VERSION:'Banco possui migração mais recente que esta versão da aplicação. Use a versão compatível; não faça downgrade automático.',
};
function knownCode(error:unknown,depth=0):string|undefined {
 if(!error||typeof error!=='object'||depth>4)return;
 const value=error as {code?:unknown;cause?:unknown;errors?:unknown[];message?:unknown};
 if(typeof value.code==='string'&&Object.hasOwn(reasons,value.code))return value.code;
 // pg não fornece código para alguns timeouts; reconheça somente mensagens exatas.
 if(value.message==='Connection terminated due to connection timeout'||value.message==='timeout exceeded when trying to connect'||value.message==='Query read timeout')return 'ETIMEDOUT';
 const cause=knownCode(value.cause,depth+1);if(cause)return cause;
 if(Array.isArray(value.errors))for(const nested of value.errors.slice(0,8)){const code=knownCode(nested,depth+1);if(code)return code;}
}
export function startupDiagnostic(error:unknown,stage:StartupStage):string {
 if(error instanceof StartupFailure)stage=error.stage;
 const code=knownCode(error);
 const fallback:Record<StartupStage,string>={runtime:'Confira Node.js 24 e configuração de runtime/proxy.',configuration:'Confira as variáveis obrigatórias e seus formatos; valores privados não são registrados.','database-connect':'Confira DATABASE_URL, Session Pooler, TLS, rede e estado do Supabase.','database-migrations':'Confira permissões do proprietário, schema privado e versões das migrações. A publicação da migração é transacional.',application:'Confira os plugins HTTP e os arquivos compilados; os detalhes internos foram omitidos.','http-listen':'Confira PORT fornecida pelo Render e disponibilidade da interface HTTP.'};
 return `[Brazi startup] etapa=${stages[stage]}; diagnóstico=${code??'NAO_CLASSIFICADO'}; ${code?reasons[code]:fallback[stage]}`;
}
