import {Store} from '../src/storage/store.js';
import {testUrl,destroy} from '../test/helpers/database.js';
export default async function(){const schema=`e2e_${process.env.BRAZI_E2E_RUN}`;if(!/^e2e_[a-f0-9]{16}$/.test(schema))throw new Error('Schema E2E inválido.');await destroy(await Store.open(testUrl(),{schema}));}
