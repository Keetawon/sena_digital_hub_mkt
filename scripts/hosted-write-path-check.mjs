// Inventory operator sources, including ignored operators. New hosted paths may
// not open their own write transaction; only the H5i helper owns that boundary.
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const helpers=new Set(['scripts/hosted-write-attestation.mjs','scripts/hosted_write_attestation.py']);
const simulations=new Set(['scripts/simulate-hosted-test.mjs']);
export function rawWriteTransactions(source){
 const found=[];
 for(const m of source.matchAll(/\.(?:query|execute)\s*\(\s*(?:f)?(['"`])\s*((?:begin|start\s+transaction)\b[^'"`]*|commit\b[^'"`]*)\1/gi))
  if(!/\bread\s+only\s*;?\s*$/i.test(m[2]))found.push({kind:'sql_transaction',line:source.slice(0,m.index).split('\n').length});
 for(const m of source.matchAll(/\.transaction\s*\(([^)]*)\)/g))
  if(!/\breadonly\s*=\s*True\s*(?:,|$)/.test(m[1]))found.push({kind:'python_transaction',line:source.slice(0,m.index).split('\n').length});
 return found;
}
export async function hostedWritePathInventory(root=process.cwd()){
 const files=[];
 async function walk(relative){
  let entries;try{entries=await readdir(path.join(root,relative),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const e of entries){const file=relative+'/'+e.name;if(e.isDirectory()&&e.name!=='__pycache__')await walk(file);
   else if(e.isFile()&&/\.(?:mjs|py)$/.test(e.name))files.push(file);}
 }
 await walk('scripts');await walk('.local/hosted-content-rollout');
 const inspected=[],violations=[];
 for(const file of files.sort()){
  const source=await readFile(path.join(root,file),'utf8');
  const hosted=file.startsWith('.local/hosted-content-rollout/')||/supabase-test-migrations|HUB_(?:SUPABASE_TEST|TRANSFER)_.*(?:DATABASE_URL|DSN)|hosted_test_profile\(|AttestedTransaction|OperatorTransaction/.test(source);
  if(!hosted||helpers.has(file)||simulations.has(file))continue;
  inspected.push(file);for(const match of rawWriteTransactions(source))violations.push({file,...match});
 }
 return {rule:'H5i',status:violations.length?'STOP':'passed',inspected,violations};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await hostedWritePathInventory();console.log(JSON.stringify(result,null,2));if(result.status!=='passed')process.exitCode=1;
}
