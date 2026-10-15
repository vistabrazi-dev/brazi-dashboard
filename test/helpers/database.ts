import 'dotenv/config';
import {randomBytes} from 'node:crypto';
import {Store} from '../../src/storage/store.js';
export function testUrl(){
 const value=process.env.TEST_DATABASE_URL;
 if(!value)throw new Error('Defina TEST_DATABASE_URL para um PostgreSQL local de teste (banco com sufixo _test).');
 const url=new URL(value);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test'))throw new Error('Testes exigem banco local com sufixo _test. Nunca use dados reais.');
 return value;
}
export async function testStore(schema='test_'+randomBytes(10).toString('hex')){return Store.open(testUrl(),{schema});}
export async function destroy(store:Store){await store.db.query(`DROP SCHEMA "${store.schema}" CASCADE`);await store.close();}
