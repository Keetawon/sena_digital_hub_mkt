import assert from 'node:assert/strict';

// Called by the existing disposable replay. It creates no process or connection.
export async function beforePhase7(db, name, state) {
  if (!name.endsWith('_facilities_features_places.sql')) return state;
  const project = (await db.query("select id from hub.projects where rem_project_id='DEMO-001'")).rows[0].id;
  await db.query(`insert into hub.project_facilities(project_id,facility_code,status,description,location_note,access_note,evidence_note)
    values($1,'pool','present','{"th":"คำอธิบายเดิม","en":"Preserved description"}',
      'Preserved location','Preserved access','Preserved evidence')`, [project]);
  const facilities = (await db.query('select to_jsonb(f) as row from hub.project_facilities f order by project_id,facility_code')).rows.map(r => r.row);
  const taxonomy = (await db.query('select to_jsonb(t) as row from hub.facility_taxonomy t order by code')).rows.map(r => r.row);
  const translations = (await db.query("select to_jsonb(t) as row from hub.content_translations t where owner_type='facility' order by id")).rows.map(r => r.row);
  return { facilities, taxonomy, translations };
}

export async function afterPhase7(db, name, state) {
  if (!state) return;
  const project = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));
  const facilities = (await db.query('select to_jsonb(f) as row from hub.project_facilities f order by project_id,facility_code')).rows.map(r => r.row);
  assert.equal(facilities.length, state.facilities.length);
  assert.deepEqual(facilities.map((row, i) => project(row, Object.keys(state.facilities[i]))), state.facilities, `${name} changed legacy facility content or editors`);
  const taxonomy = (await db.query('select to_jsonb(t) as row from hub.facility_taxonomy t where code=any($1::text[]) order by code', [state.taxonomy.map(r => r.code)])).rows.map(r => r.row);
  assert.deepEqual(taxonomy.map((row, i) => project(row, Object.keys(state.taxonomy[i]))), state.taxonomy, `${name} changed existing facility definitions`);
  const translations = (await db.query("select to_jsonb(t) as row from hub.content_translations t where owner_type='facility' order by id")).rows.map(r => r.row);
  assert.deepEqual(translations, state.translations, `${name} changed existing English review state`);
}
