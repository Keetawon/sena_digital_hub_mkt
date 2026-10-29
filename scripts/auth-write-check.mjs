// H5h release gate: qualified Auth writes are forbidden, including dynamic SQL literals.
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

function withoutComments(source) {
  let out='',quote='',block=0;
  for(let i=0;i<source.length;i++){
    const c=source[i],pair=source.slice(i,i+2);
    if(block){if(pair==='/*'){block++;i++;}else if(pair==='*/'){block--;i++;}out+=' ';continue;}
    if(quote){out+=c;if(c==='\\'&&i+1<source.length)out+=source[++i];else if(c===quote){if(source[i+1]===quote)out+=source[++i];else quote='';}continue;}
    if(['"',"'",'`'].includes(c)){quote=c;out+=c;continue;}
    if(pair==='/*'){block=1;i++;out+=' ';continue;}
    if(pair==='--'||pair==='//'||c==='#'){while(i<source.length&&source[i]!=='\n')i++;out+='\n';continue;}
    out+=c;
  }
  return out;
}

export function authWriteMatches(source) {
  let sql=withoutComments(source),previous;
  do{previous=sql;sql=sql.replace(/["'`]\s*(?:\+|\|\|)\s*["'`]/g,'');}while(sql!==previous);
  sql=sql.replace(/"([a-z_][a-z0-9_]*)"/gi,'$1');
  const matches=[];
  const patterns=[
    ['INSERT',/\binsert\s+into\s+(?:only\s+)?auth\s*\./gi],
    ['UPDATE',/\bupdate\s+(?:only\s+)?auth\s*\./gi],
    ['DELETE',/\bdelete\s+from\s+(?:only\s+)?auth\s*\./gi],
    ['TRUNCATE',/\btruncate\s+(?:table\s+)?(?:only\s+)?auth\s*\./gi],
    ['COPY',/\bcopy\s+auth\s*\./gi],
    ['MERGE',/\bmerge\s+into\s+auth\s*\./gi],
    ['DDL',/\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:(?:unique|unlogged|temporary|temp)\s+)?(?:table|view|materialized\s+view|sequence|function|procedure|type|domain|index|policy)\s+(?:if\s+(?:not\s+)?exists\s+)?auth\s*\./gi],
    ['SCHEMA_DDL',/\b(?:create|alter|drop)\s+schema\s+(?:if\s+(?:not\s+)?exists\s+)?auth\b/gi],
    ['TRIGGER',/\b(?:create|alter|drop)\s+(?:constraint\s+)?trigger\b[^;]*?\bon\s+auth\s*\./gi],
    ['POLICY',/\b(?:create|alter|drop)\s+policy\b[^;]*?\bon\s+auth\s*\./gi],
    ['RULE',/\bcreate\s+(?:or\s+replace\s+)?rule\b[^;]*?\bto\s+auth\s*\./gi],
    ['MOVE_TO_AUTH',/\balter\b[^;]*?\bset\s+schema\s+auth\b/gi],
    ['AUTH_FOREIGN_KEY_TRIGGER',/\breferences\s+auth\s*\./gi],
    ['MULTI_OBJECT_DDL',/\b(?:truncate|drop\s+(?:table|view|function|sequence|type))\b[^;]*?,\s*auth\s*\./gi],
    ['PRIVILEGE',/\b(?:grant|revoke)\b[^;]*?\bon\s+(?:(?:all\s+\w+\s+in\s+)?schema\s+auth\b|(?:table\s+|function\s+|sequence\s+|procedure\s+)?auth\s*\.)/gi],
    ['DEFAULT_PRIVILEGE',/\balter\s+default\s+privileges\b[^;]*?\bin\s+schema\s+auth\b/gi],
  ];
  for(const [kind,regex] of patterns)for(const m of sql.matchAll(regex))matches.push({kind,line:sql.slice(0,m.index).split('\n').length});
  // Dynamic identifier interpolation plus an explicit Auth identifier is not provably read-only.
  if(/['"`]auth['"`]/i.test(sql)&&/\b(?:insert\s+into|update|delete\s+from|truncate|copy|create\s+table|alter\s+table|drop\s+table)\s+[^;\n]*(?:%I|\$\{)/i.test(sql))matches.push({kind:'DYNAMIC_AUTH_WRITE',line:1});
  if(/\b(?:set\s+(?:local\s+)?search_path\s*(?:=|to)|set_config\s*\(\s*['"]search_path['"]\s*,)[^;\n]*\bauth\b/i.test(sql)&&/\b(?:insert\s+into|update|delete\s+from|truncate|copy)\b/i.test(sql))matches.push({kind:'AUTH_SEARCH_PATH_WRITE',line:1});
  return matches;
}

export function assertNoAuthWrites(source) {
  const matches=authWriteMatches(source);
  if(matches.length)throw new Error('Auth write rejected: '+matches.map(m=>m.kind).join(', '));
}

export async function authWriteInventory(root=new URL('../',import.meta.url)) {
  const profile=JSON.parse(await readFile(new URL('supabase/hosted-test/profile.json',root),'utf8'));
  const migrations=[];
  for(const file of (await readdir(new URL('supabase/migrations/',root))).filter(f=>/^\d{12}_.+\.sql$/.test(f)).sort()){
    const source=await readFile(new URL('supabase/migrations/'+file,root),'utf8'),number=Number(file.slice(8,12));
    const sha256=createHash('sha256').update(source).digest('hex'),registered=profile.migrations.find(m=>m.name===file);
    if(!registered||registered.canonical_sha256!==sha256)throw new Error('Frozen/registered migration checksum mismatch: '+file);
    migrations.push({file,number,sha256,registered_checksum_matches:true,matches:authWriteMatches(source)});
  }
  const scripts=[];
  async function scan(directory){for(const item of await readdir(new URL(directory,root),{withFileTypes:true})){
    const file=directory+item.name;
    if(item.isDirectory())await scan(file+'/');
    else if(/\.(?:mjs|cjs|js|ts|py|sql|ps1)$/i.test(file))scripts.push({file,matches:authWriteMatches(await readFile(new URL(file,root),'utf8'))});
  }}
  await scan('scripts/');
  return {status:migrations.some(m=>m.matches.length)||scripts.some(s=>s.matches.length)?'STOP':'passed',migrations,scripts};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const r=await authWriteInventory();
  console.log(JSON.stringify({status:r.status,migrations:r.migrations.length,scripts:r.scripts.length,migration_matches:r.migrations.filter(m=>m.matches.length),script_matches:r.scripts.filter(s=>s.matches.length)}));
  if(r.status!=='passed')process.exitCode=1;
}
