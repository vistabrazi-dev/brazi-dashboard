import {assertInkAllowed} from '../staging-guard.js';
import {setTimeout as sleep} from 'node:timers/promises';
import {EnvHttpProxyAgent,setGlobalDispatcher} from 'undici';
export function configureProxy(){if(process.env.HTTPS_PROXY||process.env.HTTP_PROXY||process.env.https_proxy||process.env.http_proxy)setGlobalDispatcher(new EnvHttpProxyAgent());}
export interface TransportOptions { pauseMs?:number; signal?:AbortSignal; fetcher?:typeof fetch; wait?:(ms:number,signal?:AbortSignal)=>Promise<void>; onWait?:(seconds:number)=>void|Promise<void> }
export function pacedFetch(options:TransportOptions={}):typeof fetch {
 const wait=options.wait??(async(ms,signal)=>{await sleep(ms,undefined,{signal});});
 const fetcher=options.fetcher??fetch;
 return (async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  assertInkAllowed();
  for(let attempt=0;attempt<6;attempt++){
   assertInkAllowed();
   await wait(options.pauseMs??1800,options.signal);
   assertInkAllowed();
   const signals=[AbortSignal.timeout(30000),...(options.signal?[options.signal]:[])];
   let response:Response;
   try{response=await fetcher(input,{...init,signal:AbortSignal.any(signals),redirect:'error'});}
   catch {if(options.signal?.aborted)throw new Error('Sincronização interrompida.');if(attempt>=2)throw new Error('Conexão indisponível após tentativas limitadas.');await wait(5000*2**attempt,options.signal);continue;}
   if(response.status!==429&&![502,503,504].includes(response.status))return response;
   const retry=response.headers.get('retry-after');
   const requested=retry?(/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-Date.now()):0;
   const delay=Math.max(response.status===429?60000:5000,Number.isFinite(requested)?requested:0,Math.min(240000,5000*2**attempt));
   await response.body?.cancel();
   if(delay>600000)throw new Error('API solicitou espera superior a dez minutos. Tente novamente mais tarde.');
   await options.onWait?.(Math.ceil(delay/1000));await wait(delay,options.signal);
  }
  throw new Error('API indisponível após tentativas limitadas.');
 }) as typeof fetch;
}
