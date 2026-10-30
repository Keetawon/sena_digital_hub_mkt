// H5i operator transactions. Auth row hashes never leave this process.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {authWriteMatches} from './auth-write-check.mjs';
import {authPrivilegePostflight} from './auth-protection.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schemas=['hub','hub_deployment','public_api','staging','audit','internal','rag','ads','ads_export','hub_export'];
const actors=['editor','publisher','viewer','admin','service_consumer','online_staff','agency'];
const ident=/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
export const AUTH_SNAPSHOT_SQL=`select n.nspname||'.'||c.relname relation,
 query_to_xml(format('select count(*) rows, encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,''|'' order by to_jsonb(t)::text),''''),''UTF8'')),''hex'') hash from %I.%I t',n.nspname,c.relname),false,true,'')::text fingerprint
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='auth' and c.relkind in ('r','p','f') order by c.relname`;
export const WRITE_SET_SQL=`select schemaname||'.'||relname relation,
 n_tup_ins::text inserted,n_tup_upd::text updated,n_tup_del::text deleted,n_tup_hot_upd::text hot_updated,
 coalesce(to_jsonb(s)->>'n_tup_newpage_upd','0') newpage_updated
 from pg_stat_xact_all_tables s where schemaname not in ('pg_catalog','information_schema')
 and schemaname not like 'pg_toast%' and schemaname not like 'pg_temp_%' order by schemaname,relname`;

// OIDs and deployment-specific names are normalized before hashing. Definitions
// and ACLs are inspected in memory; receipts contain object keys and hashes only.
export async function catalogSnapshot(db){
 const context=(await db.query('select current_user operator,current_database() database,(select rolname from pg_roles where oid=10) bootstrap')).rows[0];
 const queries=[
  ['role',`select rolname key,to_jsonb(r)-'oid'-'rolpassword' value from pg_roles r where rolname=current_user or rolname=any($1) or rolname like 'hub\\_%' escape '\\' or rolname like 'ads\\_%' escape '\\'`,[actors]],
  ['membership',`select r.rolname||'/'||u.rolname||'/'||g.rolname key,jsonb_build_object('role',r.rolname,'member',u.rolname,'grantor',g.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) value
   from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member join pg_roles g on g.oid=m.grantor
   where r.rolname=any($1) or u.rolname=any($1) or r.rolname~'^(hub_|ads_)' or u.rolname~'^(hub_|ads_)' or u.rolname=current_user`,[actors]],
  ['schema',`select nspname key,jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) value from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema'`,[]],
  ['relation',`select n.nspname||'.'||c.relname key,jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
   'triggers',(select jsonb_agg(jsonb_build_object('name',case when t.tgisinternal then
     (select k.conname from pg_constraint k where k.oid=t.tgconstraint)||'/'||t.tgfoid::regproc::text else t.tgname end,
     'internal',t.tgisinternal,'enabled',t.tgenabled,'definition',case when t.tgisinternal then
     regexp_replace(pg_get_triggerdef(t.oid),'RI_ConstraintTrigger_[ac]_[0-9]+','RI_ConstraintTrigger','g') else pg_get_triggerdef(t.oid) end)
     order by t.tgisinternal,(select k.conname from pg_constraint k where k.oid=t.tgconstraint),t.tgfoid::regproc::text,t.tgname)
    from pg_trigger t where t.tgrelid=c.oid)) value
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and c.relkind in ('r','p','v','m','f','S')`,[[...schemas,'auth']]],
  ['policy',`select schemaname||'.'||tablename||'/'||policyname key,to_jsonb(p) value from pg_policies p where schemaname=any($1)`,[[...schemas,'auth']]],
  ['function',`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' key,
   jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) value
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) and p.prokind in ('f','p')`,[[...schemas,'auth']]],
  ['default_acl',`select pg_get_userbyid(d.defaclrole)||'/'||coalesce(n.nspname,'*')||'/'||d.defaclobjtype::text key,jsonb_build_object('acl',d.defaclacl::text) value from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace`,[]],
  ['database_owner',`select 'current_database' key,jsonb_build_object('owner',pg_get_userbyid(datdba)) value from pg_database where datname=current_database()`,[]],
  ['database_grant',`select pg_get_userbyid(a.grantor)||'/'||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||'/'||a.privilege_type key,
   jsonb_build_object('grantable',a.is_grantable) value from pg_database d cross join lateral aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a where d.datname=current_database()`,[]],
  ['extension',`select extname key,jsonb_build_object('owner',pg_get_userbyid(extowner),'schema',n.nspname,'version',extversion) value from pg_extension e join pg_namespace n on n.oid=e.extnamespace`,[]],
  ['foreign_server',`select srvname key,jsonb_build_object('owner',pg_get_userbyid(srvowner),'fdw',f.fdwname,'type',srvtype,'version',srvversion,'acl',srvacl::text,'options_hash',md5(coalesce(srvoptions::text,''))) value from pg_foreign_server s join pg_foreign_data_wrapper f on f.oid=s.srvfdw`,[]],
  ['user_mapping',`select srvname||'/'||case when umuser=0 then 'PUBLIC' else usename end key,jsonb_build_object('options_hash',md5(coalesce(umoptions::text,''))) value from pg_user_mappings`,[]],
  ['foreign_wrapper',`select fdwname key,jsonb_build_object('owner',pg_get_userbyid(fdwowner),'acl',fdwacl::text,'handler',fdwhandler::regproc::text,'validator',fdwvalidator::regproc::text,'options_hash',md5(coalesce(fdwoptions::text,''))) value from pg_foreign_data_wrapper`,[]],
  ['event_trigger',`select evtname key,jsonb_build_object('owner',pg_get_userbyid(evtowner),'event',evtevent,'function',evtfoid::regprocedure::text,'enabled',evtenabled,'tags',evttags) value from pg_event_trigger`,[]],
 ];
 const result={};
 const role=value=>value===context.operator?'$deployment':value===context.bootstrap?'$bootstrap':value;
 const normalize=(value,key='')=>typeof value==='string'?(key==='definition'||key==='default'?value:key==='acl'?value.split(/([{},=/"])/).map(role).join(''):role(value)):Array.isArray(value)?value.map(v=>normalize(v,key)):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize(value[k],k)])):value;
 for(const [kind,sql,params] of queries){
  try{for(const row of (await db.query(sql,params)).rows)result[kind+':'+row.key.split('/').map(role).join('/')]=digest(normalize(row.value));}
  catch(error){error.gate_stage='catalog_'+kind;throw error;}
 }
 return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
export function catalogDelta(before,after){return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(k=>before[k]!==after[k]).map(key=>({key,before:before[key]??null,after:after[key]??null}));}
export function writeSet(rows){return rows.map(row=>{
 const count=Object.fromEntries(['inserted','updated','deleted','hot_updated','newpage_updated'].map(k=>[k,Number(row[k]??0)]));
 assert.ok(Object.values(count).every(n=>Number.isSafeInteger(n)&&n>=0),'Invalid transaction counter');
 return {relation:row.relation,...count,total:Object.values(count).reduce((a,b)=>a+b,0)};
 }).filter(r=>r.total>0);}
export function validateManifest(manifest){
 assert.equal(manifest?.version,'H5i');assert.equal(manifest.rehearsal?.status,'passed');assert.equal(manifest.rehearsal?.disposable,true);
 assert.ok(Number.isInteger(manifest.prefix)&&manifest.prefix>=0);assert.ok(Array.isArray(manifest.allowlist));
 assert.match(manifest.prefix_sha256??'',/^[a-f0-9]{64}$/,'Exact applied prefix proof required');
 assert.ok(manifest.allowlist.every(r=>ident.test(r)&&!r.startsWith('auth.')&&!r.startsWith('pg_')&&!r.startsWith('information_schema.')),'Auth or invalid allowlist relation');
 assert.deepEqual([...new Set(manifest.allowlist)].sort(),[...new Set(manifest.rehearsal.write_set.map(r=>r.relation))].sort(),'Allowlist must equal rehearsed write set');
 assert.ok(Array.isArray(manifest.catalog_changes));
 assert.ok(manifest.catalog_changes.every(x=>!/^\w+:auth(?:\.|$)/.test(x.key)),'Auth catalog change is forbidden');
 assert.ok(Array.isArray(manifest.external_features));assert.ok(manifest.sources&&Object.keys(manifest.sources).length>0);
}
export async function verifySources(manifest){
 validateManifest(manifest);
 for(const [file,hash] of Object.entries(manifest.sources)){
  assert.ok(!path.isAbsolute(file)&&!file.split(/[\\/]/).includes('..')&&!/(^|[/\\])\.env/.test(file),'Invalid batch source');
  assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),hash,'Rehearsed source changed');
 }
}
export async function finalDefinitionCheck(db,features=[]){
 const definitions=(await db.query(`select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' name,pg_get_functiondef(p.oid) definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1) and p.prokind in ('f','p') order by 1`,[schemas])).rows;
 const violations=[];
 for(const f of definitions){
  for(const match of authWriteMatches(f.definition))violations.push({function:f.name,kind:match.kind});
  for(const feature of ['dblink','postgres_fdw','pg_net','pg_cron'])if((feature==='pg_net'?/\b(?:pg_net|net\s*\.)/i:feature==='pg_cron'?/\b(?:pg_cron|cron\s*\.)/i:new RegExp('\\b'+feature,'i')).test(f.definition)&&!features.includes(feature))violations.push({function:f.name,kind:'undeclared_'+feature});
 }
 return {status:violations.length?'STOP':'passed',functions_checked:definitions.length,violations};
}
async function saveReceipt(receipt){
 const folder='.local/hosted-content-rollout';await mkdir(folder,{recursive:true});
 const file=path.join(folder,`h5i-attestation-${Date.now()}-${randomUUID()}.json`);
 await writeFile(file,JSON.stringify(receipt,null,2),{flag:'wx'});return file;
}
async function assertDisposable(db){
 const c=db.connectionParameters,s=db.connection?.stream;
 assert.ok(c?.host==='127.0.0.1'&&s?.remoteAddress==='127.0.0.1','Rehearsal must use a disposable loopback connection');
 const state=(await db.query("select current_database() database,to_regclass('public.disposable_test_run') marker")).rows[0];
 assert.ok((state.database==='sena_hub_local'&&state.marker)||(state.database==='hub_hosted_test_simulation'&&Number(c.port)===55434),'Disposable rehearsal marker required');
}
// Historical fixture/bootstrap transactions remain available on the fixed
// disposable connection. A hosted connection ALWAYS requires a rehearsal proof.
export async function operatorTransaction(db,manifest,body){
 if(manifest)return attestedTransaction(db,manifest,body);
 await assertDisposable(db);
 await db.query('begin');
 try{const result=await body(db);await db.query('commit');return {result};}
 catch(error){await db.query('rollback');throw error;}
}
// Both release and rehearsal call exactly this transaction boundary. A rehearsal
// always rolls back; it cannot be enabled for a hosted connection by an env flag.
export async function attestedTransaction(db,manifest,body){return transaction(db,manifest,body,false);}
export async function rehearseTransaction(db,{prefix,sources,external_features=[]},body){
 await assertDisposable(db);return transaction(db,{version:'H5i',prefix,sources,external_features},body,true);
}
async function transaction(db,manifest,body,rehearsal){
 if(!rehearsal)await verifySources(manifest);
 const receipt={rule:'H5i',started_at:new Date().toISOString(),mode:rehearsal?'disposable_rehearsal':'apply',prefix:manifest.prefix,write_set:[],status:'pending'};
 let open=false,committed=false,beforeAuth;
 try{
  // PostgreSQL retains backend-local counters until their next flush, including
  // prior committed/aborted transactions. Publish those before our boundary;
  // never reset shared statistics or subtract a live-data baseline.
  await db.query('select pg_stat_force_next_flush()');
  await db.query('begin isolation level repeatable read');open=true;
  beforeAuth=(await db.query(AUTH_SNAPSHOT_SQL)).rows;
  assert.deepEqual(writeSet((await db.query(WRITE_SET_SQL)).rows),[],'Transaction statistics were not clean at entry');
  const history=(await db.query("select to_regclass('hub_deployment.schema_migrations') present")).rows[0].present;
  const applied=history?(await db.query('select name,checksum,executed_checksum,project_ref,source,profile,environment from hub_deployment.schema_migrations order by name')).rows:[];
  const prefix=applied.length,prefixHash=digest(applied);
  assert.equal(prefix,manifest.prefix,'Rehearsed migration prefix differs');
  if(!rehearsal)assert.equal(prefixHash,manifest.prefix_sha256,'Exact rehearsed migration history differs');
  const before=await catalogSnapshot(db);
  const result=await body(db);
  receipt.write_set=writeSet((await db.query(WRITE_SET_SQL)).rows);
  const prohibited=receipt.write_set.filter(x=>x.relation.startsWith('auth.')||(!rehearsal&&!manifest.allowlist.includes(x.relation)));
  if(prohibited.length){receipt.violation='write_set';throw new Error('H5i write-set violation');}
  receipt.definitions=await finalDefinitionCheck(db,manifest.external_features);
  if(receipt.definitions.status!=='passed'){receipt.violation='final_definition';throw new Error('H5i final-definition gate failed');}
  receipt.privileges=await authPrivilegePostflight(db);
  if(receipt.privileges.status!=='passed'){receipt.violation='auth_privilege';throw new Error('H5i Auth privilege gate failed');}
  const after=await catalogSnapshot(db);receipt.catalog={before,after,changes:catalogDelta(before,after)};
  if(receipt.catalog.changes.some(x=>/^\w+:auth(?:\.|$)/.test(x.key))||(!rehearsal&&JSON.stringify(receipt.catalog.changes)!==JSON.stringify(manifest.catalog_changes))){receipt.violation='catalog';throw new Error('H5i catalog violation');}
  const changedExternal=receipt.catalog.changes.filter(x=>/^(extension|foreign_server|foreign_wrapper|user_mapping):/.test(x.key));
  if(changedExternal.some(x=>!manifest.external_features.includes(x.key))){receipt.violation='external_catalog';throw new Error('H5i undeclared external catalog change');}
  // Last database statement before COMMIT. Never retain row hashes in a receipt.
  const afterAuth=(await db.query(AUTH_SNAPSHOT_SQL)).rows;
  if(JSON.stringify(afterAuth)!==JSON.stringify(beforeAuth)){receipt.violation='same_snapshot_auth';throw new Error('H5i same-snapshot Auth violation');}
  receipt.auth_unchanged=true;
  await db.query(rehearsal?'rollback':'commit');open=false;committed=!rehearsal;receipt.status=rehearsal?'rehearsed':'committed';
  if(rehearsal){
   const derived={...manifest,prefix_sha256:prefixHash,allowlist:receipt.write_set.map(x=>x.relation),catalog_changes:receipt.catalog.changes,rehearsal:{status:'passed',disposable:true,write_set:receipt.write_set}};
   validateManifest(derived);receipt.manifest=derived;
  }
  receipt.finished_at=new Date().toISOString();const file=await saveReceipt(receipt);
  return {result,receipt,receipt_file:file,manifest:receipt.manifest};
 }catch(error){
  if(open)await db.query('rollback');receipt.status='STOP';receipt.rolled_back=open;receipt.committed=committed;receipt.error_code=error.code;receipt.gate_stage=error.gate_stage;
  receipt.finished_at=new Date().toISOString();const file=await saveReceipt(receipt);
  const safe=new Error('H5i transaction stopped; receipt: '+file);safe.cause_code=error.code??'attestation';safe.receipt=receipt;safe.receipt_file=file;throw safe;
 }finally{beforeAuth=undefined;}
}
