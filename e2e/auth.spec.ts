import {test,expect} from '@playwright/test';
test('login real protege endpoints, não solicita indicadores antes de autenticar e logout remove acesso',async({page,context})=>{
 const requests:string[]=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Bem-vindo à Brazi.'})).toBeVisible();
 expect(requests).not.toContain('/api/dashboard');expect(requests).not.toContain('/api/status');
 expect((await context.request.get('/api/status')).status()).toBe(401);
 await page.getByLabel('Usuário',{exact:true}).fill('test-user');await page.getByLabel('Senha',{exact:true}).fill(process.env.BRAZI_E2E_PASSWORD!);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sair da conta'})).toBeVisible();await expect(page.getByRole('button',{name:'Sincronizar Reserva INK'})).toBeVisible();
 expect((await context.request.get('/api/status')).status()).toBe(200);
 const cookies=await context.cookies();const session=cookies.find(c=>c.name==='brazi_session');expect(session?.httpOnly).toBe(true);expect(session?.sameSite).toBe('Strict');
 await page.reload();await expect(page.getByRole('button',{name:'Sair da conta'})).toBeVisible();
 await page.getByRole('button',{name:'Sair da conta'}).click();await expect(page.getByRole('heading',{name:'Bem-vindo à Brazi.'})).toBeVisible();expect((await context.request.get('/api/status')).status()).toBe(401);
 expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});
