export async function json<T>(url:string,options?:RequestInit):Promise<T>{
 const response=await fetch(url,options);
 if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('brazi:unauthorized'));const body=await response.json().catch(()=>({}));throw new Error(body.error||body.reason||'Não foi possível carregar os dados.');}
 return response.json() as Promise<T>;
}
