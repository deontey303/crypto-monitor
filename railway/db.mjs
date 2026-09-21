import pg from 'pg';
const {Pool}=pg;
export function postgresSql(sql){let i=0;return sql.replace(/\?/g,()=>'$'+(++i));}
export function createDB(connectionString=process.env.DATABASE_URL){
  if(!connectionString) throw new Error('database_url_missing');
  const pool=new Pool({connectionString,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});
  const statement=(text,values=[])=>({
    text,values,
    bind(...args){return statement(text,args);},
    async run(){const r=await pool.query(postgresSql(text),values);return {meta:{changes:r.rowCount??0}};},
    async first(){const r=await pool.query(postgresSql(text),values);return r.rows[0]??null;},
    async all(){const r=await pool.query(postgresSql(text),values);return {results:r.rows};}
  });
  return {
    prepare:text=>statement(text),
    async batch(statements){
      const client=await pool.connect();
      try{await client.query('BEGIN');const out=[];
        for(const s of statements){const r=await client.query(postgresSql(s.text),s.values);out.push({meta:{changes:r.rowCount??0}});}
        await client.query('COMMIT');return out;
      }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    },
    async exec(sql){return pool.query(sql);},
    async close(){return pool.end();}
  };
}
