import {createDB} from '../railway/db.mjs';import {runCycle} from './cognition-cycle.mjs';
const db=createDB();try{console.log(JSON.stringify(await runCycle({db}),null,2));}finally{await db.close();}
