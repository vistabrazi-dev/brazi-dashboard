import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
// Duas derivações simultâneas: limite de memória adequado ao serviço de uma instância.
let active=0;const queue:Array<()=>void>=[];
async function derive(password:string,salt:string):Promise<Buffer>{
 if(active<2)active++;else await new Promise<void>(resolve=>queue.push(resolve));
 try{return await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:65536,r:8,p:2,maxmem:96*1024*1024},(error,key)=>error?reject(error):resolve(key)));}
 finally{const next=queue.shift();if(next)next();else active--;}
}
const pattern=/^scrypt\$65536\$8\$2\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
export const validPasswordHash=(value:string)=>pattern.test(value);
export async function passwordHash(password:string):Promise<string>{
 if(password.length<12||password.length>256)throw new Error('Use uma senha de 12 a 256 caracteres.');
 const salt=randomBytes(16).toString('hex');
 const key=await derive(password,salt);
 return `scrypt$65536$8$2$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password:string,encoded:string):Promise<boolean>{
 const match=pattern.exec(encoded);if(!match)return false;
 const actual=await derive(password,match[1]!);
 return timingSafeEqual(actual,Buffer.from(match[2]!,'hex'));
}
