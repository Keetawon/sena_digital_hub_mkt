// Private stdin/stdout protocol for asyncpg operators. No credential crosses
// this pipe. SQL results (including Auth hashes) stay in process memory only.
import {createInterface} from 'node:readline';
import {attestedTransaction,rehearseTransaction} from './hosted-write-attestation.mjs';

const reader=createInterface({input:process.stdin,crlfDelay:Infinity});
const lines=reader[Symbol.asyncIterator]();
const receive=async()=>{const line=await lines.next();if(line.done)throw new Error('Operator pipe closed');return JSON.parse(line.value);};
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
try{
 const input=await receive();
 const db={connectionParameters:input.connection,connection:{stream:{remoteAddress:input.remoteAddress}},query:async(sql,params=[])=>{
  send({event:'query',sql,params});const reply=await receive();
  if(reply.error){const e=new Error('Database operation refused');e.code=reply.error;throw e;}
  return {rows:reply.rows};
 }};
 const body=async()=>{send({event:'ready'});const reply=await receive();if(reply.event!=='finish')throw new Error('Operator body aborted');};
 const proof=input.rehearsal
  ?await rehearseTransaction(db,input.manifest,body)
  :await attestedTransaction(db,input.manifest,body);
 send({event:'complete',receipt:proof.receipt_file,manifest:proof.manifest});
}catch(error){send({event:'stopped',receipt:error.receipt_file??null});process.exitCode=1;}
finally{reader.close();process.stdin.pause();}
