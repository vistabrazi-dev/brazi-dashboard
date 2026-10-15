import {defineConfig} from '@playwright/test';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,scryptSync} from 'node:crypto';
process.env.BRAZI_E2E_PASSWORD??=randomBytes(24).toString('hex');
process.env.BRAZI_E2E_RUN??=randomBytes(8).toString('hex');
const salt=randomBytes(16).toString('hex');
const hash=`scrypt$65536$8$2$${salt}$${scryptSync(process.env.BRAZI_E2E_PASSWORD,salt,64,{N:65536,r:8,p:2,maxmem:96*1024*1024}).toString('hex')}`;
export default defineConfig({testDir:'./e2e',fullyParallel:false,workers:1,use:{baseURL:'http://127.0.0.1:4174',locale:'pt-BR',headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}},webServer:{command:'node dist/server.js',env:{NODE_ENV:'test',AUTH_ENABLED:'true',AUTH_USERNAME:'test-user',AUTH_PASSWORD_HASH:hash,APP_ORIGIN:'http://127.0.0.1:4174',RESERVA_INK_TOKEN:'',PORT:'4174',DATABASE_PATH:join(tmpdir(),`brazi-e2e-${process.env.BRAZI_E2E_RUN}.sqlite`)},url:'http://127.0.0.1:4174/health',reuseExistingServer:false},reporter:'list'});
