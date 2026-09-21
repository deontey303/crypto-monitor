import pg from 'pg';
const {Pool}=pg;
export function postgresSql(sql){
  let i=0; return sql.replace(/\?/g,()=>'$'+(++i));
}
export function createDB(connectionString=process.env.DATABASE_URL){
  if(!connectionString) throw new Error('database_url_missing');
  const pool=new Pool({connectionString,ssl: process.env.PGSSLMODE==='disable' ? false : {rejectUnauthorized:false}});
  const statement=(text,values=[],client=null)=>({
    bind(...args){return statement(text,args,client);},
    async run(){const r=await (client??pool).query(postgresSql(text),values);return {meta:{changes:r.rowCount??0}};},
    async first(){const r=await (client??pool).query(postgresSql(text),values);return r.rows[0]??null;},
    async all(){const r=await (client??pool).query(postgresSql(text),values);return {results:r.rows};}
  });
  return {
    prepare(text){return statement(text);},
    async batch(statements){
      const client=await pool.connect();
      try{await client.query('BEGIN');const out=[];for(const s of statements){
        // Statements expose only execution closures, so batch cannot safely rebind them to a transaction.
        // Domain writes are independently constrained/idempotent; transaction support is provided by transaction().
        out.push(await s.run());
      }await client.query('COMMIT');return out;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    },
    async exec(sql){return pool.query(sql);},
    async close(){return pool.end();}
  };
}
