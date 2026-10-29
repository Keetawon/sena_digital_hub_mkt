// Hosted TEST H5h. All Auth values stay in memory; persisted comparisons use hashes.
import {createHash} from 'node:crypto';

export const AUTH_ACTIVITY_TABLES = new Set(['sessions','refresh_tokens','mfa_amr_claims','flow_state','audit_log_entries']);
export const AUTH_ACTIVITY_COLUMNS = ['updated_at','last_sign_in_at'];
const canonical = value => JSON.stringify(value, (_,v) => v && typeof v==='object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const rowsHash = rows => hash(rows.map(canonical).sort());

export function sealAuth(tables, shape) {
  if(!Array.isArray(tables.users))throw new Error('Auth users table missing');
  const users=new Set(tables.users.map(u=>String(u.id))),sessions=new Set((tables.sessions??[]).map(s=>String(s.id)));
  const result={rule:'H5h',shape_sha256:hash(shape),tables:{},orphans:{passed:true,tables:[]}};
  for(const name of Object.keys(tables).sort()) {
    const rows=tables[name],activity=AUTH_ACTIVITY_TABLES.has(name);
    const entry={class:name==='users'?'strict_identity_activity_columns':activity?'activity':'strict',rows:rows.length};
    if(name==='users') {
      const strict=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>!AUTH_ACTIVITY_COLUMNS.includes(k))));
      entry.strict_fingerprint=rowsHash(strict);
      entry.strict_columns=Object.fromEntries([...new Set(strict.flatMap(Object.keys))].sort().map(k=>[k,rowsHash(strict.map(u=>({id:u.id,value:u[k]})))]));
      entry.activity_columns=Object.fromEntries(AUTH_ACTIVITY_COLUMNS.map(k=>[k,rowsHash(rows.map(u=>({id:u.id,value:u[k]})))]));
    }else entry[activity?'activity_fingerprint':'strict_fingerprint']=rowsHash(rows);
    if(activity) {
      // Nullable pre-auth flow user/session references are valid. Non-null references must resolve.
      const orphan=rows.some(row=>[row,row.payload].filter(v=>v&&typeof v==='object').some(v=>
        v.user_id!=null&&!users.has(String(v.user_id)) || v.session_id!=null&&!sessions.has(String(v.session_id))));
      if(orphan){result.orphans.passed=false;result.orphans.tables.push('auth.'+name);}
    }
    result.tables['auth.'+name]=entry;
  }
  return result;
}

export function compareAuth(before,after) {
  if(before.rule!=='H5h'||after.rule!=='H5h')throw new Error('H5h baseline required');
  const strict=[],tables=[];
  if(before.shape_sha256!==after.shape_sha256)strict.push('auth_schema_shape');
  for(const name of [...new Set([...Object.keys(before.tables),...Object.keys(after.tables)])].sort()) {
    const a=before.tables[name],b=after.tables[name];
    if(!a||!b||a.class!==b.class){strict.push(name+':inventory');tables.push({table:name,class:b?.class??a?.class,strict_match:false});continue;}
    const row={table:name,class:b.class,row_count_delta:b.rows-a.rows};
    if(b.class==='activity')row.changed=a.activity_fingerprint!==b.activity_fingerprint;
    else {
      row.strict_match=a.strict_fingerprint===b.strict_fingerprint;
      if(!row.strict_match)strict.push(name);
      if(name==='auth.users'){
        row.strict_changed_columns=[...new Set([...Object.keys(a.strict_columns),...Object.keys(b.strict_columns)])].filter(k=>a.strict_columns[k]!==b.strict_columns[k]).sort();
        row.activity_changed_columns=AUTH_ACTIVITY_COLUMNS.filter(k=>a.activity_columns[k]!==b.activity_columns[k]);
      }
    }
    tables.push(row);
  }
  if(!after.orphans.passed)strict.push('orphan_activity_row');
  return {status:strict.length?'STOP':'passed',strict_differences:strict,tables,orphan_check:after.orphans};
}

export function checkAuthPrivileges(rows) {
  const violations=rows.filter(r=>r.insert||r.update||r.delete||r.truncate||r.owns_object);
  return {status:violations.length?'STOP':'passed',violations};
}

export async function captureAuth(db) {
  const names=(await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind in ('r','p') order by c.relname")).rows.map(x=>x.relname);
  const shape=(await db.query(`select c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'generated',a.attgenerated,'identity',a.attidentity,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
     from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
     where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns,
    (select jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid),
      'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred) order by k.conname)
     from pg_constraint k where k.conrelid=c.oid) constraints
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind in ('r','p') order by c.relname`)).rows;
  const tables={};
  for(const name of names){
    if(!/^[a-z_][a-z0-9_]*$/.test(name))throw new Error('Unexpected Auth table identifier');
    tables[name]=(await db.query(`select to_jsonb(t) row from auth."${name}" t`)).rows.map(x=>x.row);
  }
  return {sealed:sealAuth(tables,shape),tables,shape};
}

export async function authPrivilegePostflight(db) {
  // Includes inherited/SET-able ownership, PUBLIC privileges and all registered actor roles.
  const actors=['editor','publisher','viewer','service_consumer','admin','online_staff','agency'];
  const roles=(await db.query(`select oid,rolname from pg_roles where rolname=any($1::text[])
    or rolname like 'hub\\_%' escape '\\' or rolname like 'ads\\_%' escape '\\' order by rolname`,[actors])).rows;
  const rows=[];
  for(const role of roles){
    rows.push(...(await db.query(`select $1::text role,n.nspname||'.'||c.relname object,
      (has_table_privilege($2::oid,c.oid,'INSERT') or has_any_column_privilege($2::oid,c.oid,'INSERT')) "insert",
      (has_table_privilege($2::oid,c.oid,'UPDATE') or has_any_column_privilege($2::oid,c.oid,'UPDATE')) "update",
      has_table_privilege($2::oid,c.oid,'DELETE') "delete",has_table_privilege($2::oid,c.oid,'TRUNCATE') "truncate",false owns_object
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind in ('r','p','v','m','f')`,[role.rolname,role.oid])).rows);
    rows.push(...(await db.query(`select $1::text role,object,false "insert",false "update",false "delete",false "truncate",true owns_object from (
      select nspname object,nspowner owner from pg_namespace where nspname='auth'
      union all select n.nspname||'.'||c.relname,c.relowner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth'
      union all select n.nspname||'.'||p.proname,p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth'
      union all select n.nspname||'.'||t.typname,t.typowner from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='auth'
    ) objects where owner=$2::oid or pg_has_role($2::oid,owner,'MEMBER')`,[role.rolname,role.oid])).rows);
  }
  return {...checkAuthPrivileges(rows),roles_checked:roles.map(r=>r.rolname),absent_roles:['hub_runtime','hub_media_worker','hub_media_worker_login',...actors].filter(r=>!roles.some(x=>x.rolname===r)),table_role_checks:rows.length};
}

export async function protectedPostflight(db,baseline) {
  if(baseline.rule!=='H5h'||Object.keys(baseline.protected).length!==57)throw new Error('Complete H5h TEST baseline required');
  const tables=[];
  for(const [table,expected] of Object.entries(baseline.protected)){
    if(!/^(hub|staging|rag|ads)\.[a-z_]+$/.test(table))throw new Error('Invalid protected identifier');
    const now=(await db.query(`select count(*)::int rows,md5(coalesce(string_agg(v::text,'|' order by v::text),'')) fingerprint from (select to_jsonb(t) v from ${table} t) q`)).rows[0];
    tables.push({table,class:'strict',matched:now.rows===expected.rows&&now.fingerprint===expected.fingerprint});
  }
  const auth=compareAuth(baseline.auth_baseline,(await captureAuth(db)).sealed),privileges=await authPrivilegePostflight(db);
  return {status:tables.every(t=>t.matched)&&auth.status==='passed'&&privileges.status==='passed'?'passed':'STOP',tables,auth,privileges};
}

// Call outside a write transaction: session/token cascades must share one snapshot.
export async function protectedReadOnlySnapshot(db,baseline) {
  await db.query('begin isolation level repeatable read read only');
  try{return await protectedPostflight(db,baseline);}
  finally{await db.query('rollback');}
}
