import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFile,writeFile,stat} from 'node:fs/promises';
const MAGIC=Buffer.from('BRAZI-SNAPSHOT-1\n');
const LIMIT=128*1024*1024;
export async function readKey(path:string){
 const info=await stat(path);if(!info.isFile()||(info.mode&0o077)!==0)throw new Error('Arquivo de chave deve ser privado (0600).');
 const key=await readFile(path);if(key.length!==32)throw new Error('Chave inválida.');return key;
}
export async function createKey(path:string){await writeFile(path,randomBytes(32),{mode:0o600,flag:'wx'});}
export async function writeEncrypted(path:string,text:string,key:Buffer){
 if(Buffer.byteLength(text)>LIMIT)throw new Error('Snapshot excede limite operacional de 128 MiB.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const bytes=Buffer.concat([MAGIC,iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]);
 await writeFile(path,bytes,{mode:0o600,flag:'wx'});
}
export async function readEncrypted(path:string,key:Buffer){
 const info=await stat(path);if(info.size>LIMIT+128||!info.isFile())throw new Error('Pacote excede limite operacional.');
 const bytes=await readFile(path);if(!bytes.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('Formato criptografado obrigatório.');
 const offset=MAGIC.length,decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(offset,offset+12));
 decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(offset+12,-16)),decipher.final()]).toString('utf8');
}
