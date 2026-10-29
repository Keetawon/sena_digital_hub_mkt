// Inspect only public source/bundle text; never open ignored credential locations.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {PROVIDER_KEY_NAMES,WORKER_SECRET_NAMES} from './provider-keys.mjs';

const names=[...PROVIDER_KEY_NAMES,...WORKER_SECRET_NAMES,'access_key_id','secret_access_key'];
export function credentialFindings(source,{browser=false}={}) {
 const result=[];
 const patterns=[['provider_token',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ['github_token',/\bgh[pousr]_[A-Za-z0-9]{30,}/g],['private_key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{20,}?-----END/g],
  ['scram_verifier',/SCRAM-SHA-256\$[0-9]{4,}:[A-Za-z0-9+/=]{16,}\$[A-Za-z0-9+/=]+:/g]];
 for(const [kind,regex] of patterns)for(const match of source.matchAll(regex))result.push({kind,line:source.slice(0,match.index).split('\n').length});
 for(const name of names){
  const regex=new RegExp(`\\b${name}['\"]?\\s*[:=]\\s*['\"]([^'\"\\r\\n]{24,})['\"]`,'g');
  for(const match of source.matchAll(regex)){
   const fictionalR2Id=name==='access_key_id'&&/^H1_[A-Z_0-9]+$/.test(match[1]);
   if(!fictionalR2Id&&!/synthetic|\$\{|process\.env|os\.environ|example|placeholder/i.test(match[1]))result.push({kind:'credential_assignment',variable:name,line:source.slice(0,match.index).split('\n').length});
  }
 }
 if(browser)for(const name of [...PROVIDER_KEY_NAMES,...WORKER_SECRET_NAMES])if(source.includes(name))result.push({kind:'worker_or_provider_variable_in_browser',variable:name});
 return result;
}

export async function scanCredentials(){
 const files=spawnSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8',windowsHide:true});
 if(files.status!==0)throw new Error('Source inventory failed');
 const paths=files.stdout.trim().split(/\r?\n/).filter(f=>/\.(?:py|mjs|js|cjs|ts|tsx|sql|json|md|service|socket|conf)$/.test(f)&&!/(^|\/)\.env/.test(f));
 const findings=[];let sourceFiles=0,browserFiles=0;
 for(const file of paths){sourceFiles++;for(const finding of credentialFindings(await readFile(file,'utf8')))findings.push({file,...finding});}
 async function browser(dir){for(const item of await readdir(dir,{withFileTypes:true})){
  const file=dir+'/'+item.name;
  if(item.isDirectory())await browser(file);
  else if(/\.(?:js|json|map)$/.test(file)){browserFiles++;for(const finding of credentialFindings(await readFile(file,'utf8'),{browser:true}))findings.push({file,...finding});}
 }}
 await browser('apps/admin/.next/static');
 return {status:findings.length?'STOP':'passed',source_files:sourceFiles,browser_files:browserFiles,matches:findings.length,findings,credential_files_read:false,variable_names:names};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report=await scanCredentials();
 await writeFile('artifacts/hosted-content-rollout/h5e-credential-scan.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));if(report.matches)process.exitCode=1;
}
