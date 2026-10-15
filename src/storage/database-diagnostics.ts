export const hasCredentialPlaceholder=(value:string)=>/^(?:\[YOUR[-_]PASSWORD\]|YOUR[-_]PASSWORD|<YOUR[-_]PASSWORD>|\[SUA_SENHA\]|\[PROJECT[-_]REF\])$/i.test(value);
// Somente categorias e nomes fixos; nenhum fragmento da URL é emitido.
export function databaseDiagnostics(value:string|undefined,environment:NodeJS.ProcessEnv=process.env):string {
 const flags:string[]=['fonte=ambiente-do-backend'];
 const present=['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGSSLNEGOTIATION','PGOPTIONS','PGREPLICATION'].filter(name=>Boolean(environment[name]));
 flags.push('variaveis-PG-presentes='+(present.join(',')||'nenhuma'));
 if(!value)return '[Brazi database] '+flags.concat('url=ausente').join('; ');
 try{
  const url=new URL(value);const pooler=url.hostname.endsWith('.pooler.supabase.com'),direct=url.hostname.endsWith('.supabase.co')&&url.hostname.startsWith('db.');
  flags.push('endpoint='+(pooler?'supabase-pooler':direct?'supabase-direto':'outro'));
  flags.push('modo='+(pooler?(url.port==='6543'?'transaction':!url.port||url.port==='5432'?'session':'porta-nao-padrao'):'nao-classificado'));
  const user=decodeURIComponent(url.username),password=decodeURIComponent(url.password);
  flags.push('usuario='+(pooler?(user==='postgres'?'postgres-sem-sufixo':/^postgres\.[a-z0-9]+$/.test(user)?'postgres-com-sufixo':'outro-formato'):'nao-classificado'));
  flags.push('senha='+(password?'presente-na-url':'ausente-na-url'));
  if(hasCredentialPlaceholder(password)||/\[PROJECT[-_]REF\]/i.test(user))flags.push('alerta=possivel-placeholder');
  if(value.trim()!==value||/[\r\n\t]/.test(value))flags.push('alerta=espacos-ou-quebras-na-url');
  flags.push('tls=verificacao-obrigatoria');
 }catch{flags.push('url=formato-invalido');}
 return '[Brazi database] '+flags.join('; ');
}
export class DatabaseConfigurationError extends Error {
 constructor(readonly code:string){super('Configuração PostgreSQL inválida.');}
}
