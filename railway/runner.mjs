import {readFile} from 'node:fs/promises';
import {createDB} from './db.mjs';
import {run} from '../cloudflare/worker.mjs';
const source=process.argv[2];
if(!['dex','cmc'].includes(source)){console.error('usage: node railway/runner.mjs dex|cmc');process.exit(2);}
const DB=createDB();
try{
  await DB.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  await run(source,{...process.env,DB},Date.now());
} finally {await DB.close();}
