import {createServer} from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

export async function freeLoopbackPort() {
  const listener=createServer();
  await new Promise((resolve,reject)=>listener.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port}=listener.address();
  await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
  if([55432,8000,3000].includes(port))return freeLoopbackPort();
  return port;
}

// The probe cannot reserve a port for postgres. Retry only a bind collision;
// never stop the listener which won the race, or expose postgres diagnostics.
export async function startPostgresOnFreePort(options) {
  for(let attempt=0;attempt<5;attempt++) {
    let collision=false;
    const port=await freeLoopbackPort();
    const server=new EmbeddedPostgres({...options,port,onLog:message=>{
      if(/address already in use|only one usage of each socket address|could not bind.*(?:10048|EADDRINUSE)/i.test(message))collision=true;
    }});
    try {await server.start();return {server,port};}
    catch(error) {
      // start() rejects after its own process closes. Discard that dead handle
      // so the dependency's exit hook cannot act on a subsequently reused PID.
      if(server.process?.exitCode!==null)server.process=undefined;
      if(!collision)throw new Error('Disposable PostgreSQL startup failed',{cause:error});
    }
  }
  throw new Error('Disposable PostgreSQL port was taken on all five startup attempts');
}
