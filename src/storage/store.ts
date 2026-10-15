import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import type {Order,Product,RefundHistory,Snapshot} from '../domain/models.js';
export interface Run {id:number;status:string;stage:string;page:number;pages:number;processed:number;error:string|null;started_at:string;finished_at:string|null;heartbeat:number}
export class Store {
 readonly db:DatabaseSync;
 constructor(path:string){
  if(path!==':memory:'){mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});}
  this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,day TEXT NOT NULL,data TEXT NOT NULL,seen INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS orders_day ON orders(day);
   CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS refunds(order_id INTEGER PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY,status TEXT NOT NULL,stage TEXT NOT NULL,page INTEGER NOT NULL DEFAULT 0,pages INTEGER NOT NULL DEFAULT 0,processed INTEGER NOT NULL DEFAULT 0,error TEXT,started_at TEXT NOT NULL,finished_at TEXT,heartbeat INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 }
 acquire():number|null {
  this.db.exec('BEGIN IMMEDIATE');
  try {
   this.db.prepare("UPDATE runs SET status='failed',error='Execução interrompida; tente novamente.',finished_at=? WHERE status='running' AND heartbeat < ?").run(new Date().toISOString(),Date.now()-120000);
   if(this.db.prepare("SELECT id FROM runs WHERE status='running'").get()){this.db.exec('COMMIT');return null;}
   const result=this.db.prepare("INSERT INTO runs(status,stage,started_at,heartbeat) VALUES('running','orders',?,?)").run(new Date().toISOString(),Date.now());
   this.db.exec('COMMIT');return Number(result.lastInsertRowid);
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 progress(id:number,stage:string,page:number,pages:number,processed:number){this.db.prepare('UPDATE runs SET stage=?,page=?,pages=?,processed=?,heartbeat=? WHERE id=? AND status=\'running\'').run(stage,page,pages,processed,Date.now(),id);}
 heartbeat(id:number){this.db.prepare("UPDATE runs SET heartbeat=? WHERE id=? AND status='running'").run(Date.now(),id);}
 fail(id:number,error:string){this.db.prepare("UPDATE runs SET status='failed',error=?,finished_at=? WHERE id=? AND status='running'").run(error,new Date().toISOString(),id);}
 commit(run:number,snapshot:Snapshot,timezone:string){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const owner=this.db.prepare('SELECT status FROM runs WHERE id=?').get(run);
   if(owner?.status!=='running')throw new Error('Esta execução perdeu a concessão de sincronização.');
   const putOrder=this.db.prepare('INSERT INTO orders(id,day,data,seen) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,data=excluded.data,seen=excluded.seen');
   for(const order of snapshot.orders)putOrder.run(order.id,order.day,JSON.stringify(order),run);
   // Ausências da origem são preservadas para conciliação; nunca apagadas silenciosamente.
   const missing=this.db.prepare('SELECT id,data FROM orders WHERE seen<>?').all(run);
   for(const row of missing){const order=JSON.parse(String(row.data)) as Order;order.missing=true;this.db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(order),Number(row.id));}
   const putProduct=this.db.prepare('INSERT INTO products(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
   for(const product of snapshot.products)putProduct.run(product.id,JSON.stringify(product));
   const putRefund=this.db.prepare('INSERT INTO refunds(order_id,data) VALUES(?,?) ON CONFLICT(order_id) DO UPDATE SET data=excluded.data');
   for(const history of snapshot.refunds)putRefund.run(history.orderId,JSON.stringify(history));
   this.db.prepare("INSERT INTO meta(key,value) VALUES('timezone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(timezone);
   this.db.prepare("UPDATE runs SET status='success',stage='complete',finished_at=?,heartbeat=? WHERE id=?").run(new Date().toISOString(),Date.now(),run);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 orders(start?:string,end?:string):Order[]{return (start&&end?this.db.prepare('SELECT data FROM orders WHERE day BETWEEN ? AND ? ORDER BY day,id').all(start,end):this.db.prepare('SELECT data FROM orders ORDER BY day,id').all()).map(r=>JSON.parse(String(r.data)) as Order);}
 products():Product[]{return this.db.prepare('SELECT data FROM products ORDER BY id').all().map(r=>JSON.parse(String(r.data)) as Product);}
 refunds():RefundHistory[]{return this.db.prepare('SELECT data FROM refunds').all().map(r=>JSON.parse(String(r.data)) as RefundHistory);}
 status(){
  const run=this.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get() as unknown as Run|undefined;
  const success=this.db.prepare("SELECT id,finished_at FROM runs WHERE status='success' ORDER BY id DESC LIMIT 1").get();
  const coverage=this.db.prepare('SELECT MIN(day) AS first,MAX(day) AS last,COUNT(*) AS orders FROM orders').get();
  const products=this.db.prepare('SELECT COUNT(*) AS count FROM products').get();
  const tz=this.db.prepare("SELECT value FROM meta WHERE key='timezone'").get();
  return {run:run?{id:run.id,status:run.status==='running'&&run.heartbeat<Date.now()-120000?'interrupted':run.status,stage:run.stage,page:run.page,pages:run.pages,processed:run.processed,error:run.error}:null,lastSuccess:success?.finished_at??null,version:success?.id??0,coverage,products:Number(products?.count??0),timezone:tz?.value??null};
 }
 close(){this.db.close();}
}
