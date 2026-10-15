import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {parse} from 'yaml';
import {settings} from '../src/settings.js';
import {passwordHash} from '../src/auth/password.js';
test('Blueprint produz configuração segura, PORT nativa e dados fora do checkout',async()=>{
 const yaml=parse(readFileSync('render.yaml','utf8'));assert.equal(yaml.services.length,1);const service=yaml.services[0];
 assert.equal(service.type,'web');assert.equal(service.runtime,'node');assert.notEqual(service.plan,'free');assert.equal(service.numInstances,1);assert.equal(service.disk.mountPath,'/var/data');assert.ok(service.disk.sizeGB>=1);assert.equal(service.autoDeploy,false);
 const env:NodeJS.ProcessEnv={};for(const item of service.envVars){if(item.value!==undefined)env[item.key]=String(item.value);}
 assert.equal(env.PORT,undefined);env.PORT='10000';env.RENDER_EXTERNAL_URL='https://brazi-test.example';env.AUTH_USERNAME='test-user';env.AUTH_PASSWORD_HASH=await passwordHash(randomBytes(24).toString('hex'));
 const config=settings(env);assert.equal(config.PORT,10000);assert.equal(config.host,'0.0.0.0');assert.ok(config.DATABASE_PATH.startsWith(service.disk.mountPath+'/'));assert.equal(config.auth.origin,env.RENDER_EXTERNAL_URL);assert.equal(config.auth.enabled,true);
 for(const name of ['RESERVA_INK_TOKEN','AUTH_USERNAME','AUTH_PASSWORD_HASH']){const item=service.envVars.find((v:{key:string})=>v.key===name);assert.equal(item.sync,false);assert.equal(item.value,undefined);}
 assert.match(service.buildCommand,/npm ci --include=dev/);assert.match(service.buildCommand,/npm prune --omit=dev/);assert.equal(service.startCommand,'npm start');assert.equal(service.healthCheckPath,'/health');
});
