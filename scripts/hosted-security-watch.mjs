// H5i F: report only. No row values, Auth timestamps, tokens, IPs or user agents.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {configuration,PROJECT_REF,requireVerifiedTls,safeError} from './supabase-test-migrations.mjs';

export async function securityWatch(db,since){
 if(!Number.isFinite(Date.parse(since)))throw new Error('An explicit observation window is required');
 const users=(await db.query(`select coalesce(raw_app_meta_data->>'provider','unknown') provider,count(*)::int count
  from auth.users where created_at >= $1::timestamptz group by 1 order by 1`,[since])).rows;
 const identities=(await db.query(`select coalesce(provider,'unknown') provider,count(*)::int count
  from auth.identities where created_at >= $1::timestamptz group by 1 order by 1`,[since])).rows;
 const assignments=(await db.query(`select id::text audit_id,actor::text acting_user_id,table_name,operation,
  coalesce(after_row->>'account_id',before_row->>'account_id',after_row->>'id',before_row->>'id') account_id,
  array(select field from unnest(array['status','hub_role','can_manage_users','can_publish','template_key','actions','special_actions']) field
    where before_row->field is distinct from after_row->field) changed_fields
  from audit.change_log where occurred_at >= $1::timestamptz and table_name in ('hub.user_account','hub.account_permission')
   and (before_row->'status' is distinct from after_row->'status' or before_row->'hub_role' is distinct from after_row->'hub_role'
    or before_row->'can_manage_users' is distinct from after_row->'can_manage_users'
    or before_row->'can_publish' is distinct from after_row->'can_publish'
    or before_row->'template_key' is distinct from after_row->'template_key'
    or before_row->'actions' is distinct from after_row->'actions' or before_row->'special_actions' is distinct from after_row->'special_actions')
  order by id`,[since])).rows;
 const postgres=(await db.query(`select coalesce(bool_or(has_table_privilege('postgres',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
  or has_any_column_privilege('postgres',c.oid,'INSERT,UPDATE')),false) can_write
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind in ('r','p','v','f')`)).rows[0].can_write;
 return {rule:'H5i_F',informational_only:true,new_auth_users_by_provider:users,new_auth_identities_by_provider:identities,
  account_assignment_changes:assignments,postgres_can_write_auth:postgres};
}

export async function workerAttribution(db,since){
 const rows=(await db.query(`select table_name,
  case when table_name='hub.media_jobs' then coalesce(after_row->>'kind',before_row->>'kind','unknown') else null end kind,
  count(*)::int changes from audit.change_log where occurred_at >= $1::timestamptz and database_role='hub_media_worker'
  group by 1,2 order by 1,2`,[since])).rows;
 // The approved configuration-flip audit is not a queue mutation. It is listed
 // separately; broker reads have their own audit table-name marker.
 const nonJob=new Set(['hub.media_worker_status','hub.media_image_fetch']);
 const violations=rows.filter(r=>!nonJob.has(r.table_name)&&(r.table_name!=='hub.media_jobs'||r.kind!=='image_suggestion'));
 return {status:violations.length?'STOP':'passed',database_role:'hub_media_worker',rows,violations};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db;
 try{
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--since')throw new Error('Use --since <ISO observation start>');
  const config=configuration(process.env,['--project-ref',PROJECT_REF]);
  db=new pg.Client({connectionString:config.connectionString,ssl:{rejectUnauthorized:true,ca:await readFile(config.caFile,'utf8')}});
  await db.connect();requireVerifiedTls(db);await db.query('begin isolation level repeatable read read only');
  const report=await securityWatch(db,args[1]);await db.query('rollback');console.log(JSON.stringify(report,null,2));
 }catch(error){console.error(safeError(error));process.exitCode=1;}
 finally{await db?.end();}
}
