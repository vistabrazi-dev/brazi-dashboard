// Senha nunca é aceita em argumentos, variável de ambiente ou arquivo.
import {stdin,stdout} from 'node:process';
import {emitKeypressEvents} from 'node:readline';
if(!stdin.isTTY||!stdout.isTTY){console.error('Execute em um terminal interativo; a senha não será exibida.');process.exit(1);}
const {passwordHash}=await import('../dist/auth/password.js').catch(()=>{console.error('Execute npm run build antes de gerar o hash.');process.exit(1);});
function hidden(prompt){
 stdout.write(prompt);emitKeypressEvents(stdin);stdin.setRawMode(true);stdin.resume();
 return new Promise((resolve,reject)=>{let value='';const handler=(text,key)=>{
  if(key?.ctrl&&key.name==='c'){cleanup();reject(new Error('Cancelado.'));return;}
  if(key?.name==='return'||key?.name==='enter'){cleanup();resolve(value);return;}
  if(key?.name==='backspace'){value=Array.from(value).slice(0,-1).join('');return;}
  if(text&&!key?.ctrl&&!key?.meta&&!text.includes('\u001b')&&value.length<=256)value+=text;
 };const cleanup=()=>{stdin.off('keypress',handler);stdin.setRawMode(false);stdin.pause();stdout.write('\n');};stdin.on('keypress',handler);});
}
try{const password=await hidden('Nova senha (12–256 caracteres; entrada oculta): ');const confirmation=await hidden('Confirme a senha: ');if(password!==confirmation)throw new Error('As senhas não coincidem.');const hash=await passwordHash(password);console.log('Copie somente o hash abaixo para AUTH_PASSWORD_HASH no Render. Não versione nem compartilhe o valor.');console.log(hash);}catch(error){console.error(error instanceof Error?error.message:'Não foi possível gerar o hash.');process.exitCode=1;}
