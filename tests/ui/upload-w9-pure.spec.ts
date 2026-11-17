import { expect, test } from '@playwright/test';
import { parseUploadContext, uploadContextHeader, uploadFileError, uploadFileLimit, type UploadContext, type UploadEvidence } from '../../apps/admin/lib/upload-context';
import { stockEvidenceLabels, useFileSuggestion } from '../../apps/admin/lib/upload-suggestions';
import type { Metadata, MediaTag } from '../../apps/admin/components/media-common';

const project: UploadContext = { v: 1, kind: 'project', ref: 'synthetic-project', category: 'exterior', purpose: 'media' };
const contexts: UploadContext[] = [project, {v:1,kind:'intake'}, {v:1,kind:'brand',ref:'synthetic-brand',purpose:'logo_white'},
 {v:1,kind:'model',project_ref:'synthetic-project',ref:'synthetic-model',category:'floor_plan',purpose:'floor_plan'},
 {v:1,kind:'commercial_type',project_ref:'synthetic-project',ref:'synthetic-type',category:null,purpose:'structural_plan'},
 {v:1,kind:'media_target',project_ref:'synthetic-project',target_type:'facility',target_key:'pool',category:'facility',usage:'gallery'},
 {v:1,kind:'disclosure',project_ref:'synthetic-project',ref:null}, {v:1,kind:'knowledge',candidate_id:'66000000-0000-4000-8000-000000000001'}];
for (const context of contexts) test('finite context round trip: '+context.kind, () => expect(parseUploadContext(uploadContextHeader(context))).toEqual(context));
for (const [name, raw] of Object.entries({
 missing:null, duplicate:'{"v":1,"kind":"intake","kind":"intake"}', escapedDuplicate:'{"v":1,"kind":"intake","k\\u0069nd":"intake"}',
 repeated:'{"v":1,"kind":"intake"}, {"v":1,"kind":"intake"}', nested:'{"v":1,"kind":"intake","extra":{}}',
 prototype:'{"v":1,"kind":"intake","__proto__":null}', privateStamp:'{"v":1,"kind":"intake","processing_class":"marketing"}',
 control:'{"v":1,\n"kind":"intake"}', nonAscii:'{"v":1,"kind":"โครงการ"}',
 oversized:' '.repeat(2049), nonfinite:'{"v":NaN,"kind":"intake"}', wrongPurpose:JSON.stringify({...project,purpose:'logo_white'}),
 missingCategory:JSON.stringify({v:1,kind:'project',ref:'synthetic-project',purpose:'media'}),
})) test('reject context before bytes: '+name, () => expect(()=>parseUploadContext(raw)).toThrow());

test('limits use private precedence, boundary inclusivity, and exact file purpose', () => {
 const mb=1024*1024;
 for (const [mime,limit] of [['image/png',30],['image/jpeg',30],['image/webp',30],['application/pdf',50],['image/svg+xml',2]] as const) {
  expect(uploadFileLimit(project,mime)).toBe(limit*mb);
  expect(uploadFileError({size:limit*mb,type:mime},project)).toBeNull();
  expect(uploadFileError({size:limit*mb+1,type:mime},project)).not.toBeNull();
 }
 for (const context of [{v:1,kind:'intake'}, {...project,category:null}, {...project,category:'legal_document'},
  {v:1,kind:'model',project_ref:'p',ref:'m',category:'floor_plan',purpose:'structural_plan'},
  {v:1,kind:'disclosure',project_ref:'p',ref:null}] as UploadContext[]) {
  expect(uploadFileLimit(context,'application/pdf')).toBe(10*mb); expect(uploadFileLimit(context,'image/png')).toBe(10*mb);
  expect(uploadFileLimit(context,'image/svg+xml')).toBe(0);
 }
 expect(uploadFileLimit({...project,purpose:'brochure'},'image/png')).toBe(0);
 expect(uploadFileLimit({...project,purpose:'hero'},'application/pdf')).toBe(0);
 expect(uploadFileLimit(contexts[2],'application/pdf')).toBe(0);
 expect(uploadFileError({size:0,type:'image/png'},project)).not.toBeNull();
});
const current = { media_category:'exterior',caption:{th:'kept caption',en:'English'},credit:{en:'English credit'},alt_text:{th:'kept alt'},
 image_kind:null,taken_at:null,tags:['old'],people:'unknown',third_party_marks:'unknown',metadata_state:'confirmed',ai_exposure:'internal',marketing_publication:false } as Metadata;
const evidence = {suggestions:{source:'file_metadata',confirmed:false,values:{caption:'file caption',credit:'file credit',
 taken_at:{value:'2020-01-02T03:04:05',offset_known:false},image_kind:'render',tags:['active','inactive','wrong-category'],stock:'present',unmapped_keywords:['unmapped'],proximity:'near'}}} as UploadEvidence;
test('Use changes only the requested draft field and requires ordinary confirmation', () => {
 const before=structuredClone(current);
 const updated=useFileSuggestion(current,evidence,'caption',[]);
 expect(updated).toEqual({...current,caption:{...current.caption,th:'file caption'},metadata_state:'needs_review'});
 expect(current).toEqual(before); expect(updated).not.toHaveProperty('suggestions');
 expect(updated.ai_exposure).toBe('internal'); expect(updated.marketing_publication).toBe(false);
 expect(useFileSuggestion(current,evidence,'stock',[]).image_kind).toBe('stock');
 expect(useFileSuggestion(current,evidence,'credit',[]).credit).toEqual({en:'English credit',th:'file credit'});
 expect(useFileSuggestion(current,evidence,'taken_at',[]).taken_at).toBe('2020-01-02');
});
test('Use cannot promote unknown tags, silently truncate credit, or consume another suggestion source', () => {
 const tags=[{code:'active',status:'active',allowed_categories:['exterior']},{code:'inactive',status:'inactive',allowed_categories:[]},{code:'wrong-category',status:'active',allowed_categories:['interior']}] as MediaTag[];
 expect(useFileSuggestion(current,evidence,'tags',tags).tags).toEqual(['active']);
 expect(useFileSuggestion(current,{...evidence,suggestions:{...evidence.suggestions,values:{credit:'x'.repeat(501)}}},'credit',tags)).toBe(current);
 expect(useFileSuggestion(current,{...evidence,suggestions:{...evidence.suggestions,source:'other' as 'file_metadata'}},'caption',tags)).toBe(current);
});

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { uploadText } from '../../apps/admin/lib/upload-text';

function projectBatch(initialCategory: string, failure?: 'upload'|'binding') {
 const requireAdmin=createRequire(resolve('apps/admin/package.json'));
 const ts=requireAdmin('typescript') as typeof import('../../apps/admin/node_modules/typescript');
 const path='apps/admin/components/project-assets.tsx';
 const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 const findFunction=(root: import('../../apps/admin/node_modules/typescript').Node,name:string)=>{
  let result: import('../../apps/admin/node_modules/typescript').FunctionDeclaration|undefined;
  const visit=(node:import('../../apps/admin/node_modules/typescript').Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)result=node;ts.forEachChild(node,visit);};
  visit(root);if(!result)throw new Error('Missing actual function '+name);return result;
 };
 const owner=findFunction(source,'ProjectUploadDialog');
 let disabled='';
 const visit=(node:import('../../apps/admin/node_modules/typescript').Node)=>{
  if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='UploadCategory'){
   const attr=node.attributes.properties.find(item=>ts.isJsxAttribute(item)&&item.name.getText(source)==='disabled');
   if(attr&&ts.isJsxAttribute(attr)&&attr.initializer&&ts.isJsxExpression(attr.initializer))disabled=attr.initializer.expression!.getText(source);
  }ts.forEachChild(node,visit);
 };visit(owner);expect(disabled).toBeTruthy();
 const state={uploads:0,binds:0,errors:[] as string[]};
 const globals:any={category:initialCategory,uploadContext:{...project,category:initialCategory||null,purpose:'hero'},purpose:'hero',
  items:[{key:1,file:new File(['synthetic'],'sample.png',{type:'image/png'}),alt:'Synthetic caption',status:'ready',error:''}],
  pending:false,needsReload:false,attempted:false,acceptedTypes:['image/png'],uploadFileError,uploadText,
  base:'v1/admin/projects/synthetic-project',latest:{current:{updated_at:'initial',assets:[]}},onProjectChanged(){},
  attached:()=>undefined,
  setError(value:string){state.errors.push(value);},
  setPending(value:boolean){globals.pending=value;},setAttempted(value:boolean){globals.attempted=value;},
  setNeedsReload(value:boolean){globals.needsReload=value;},
  setItems(value:any[]){globals.items=value;globals.remaining=value.filter(item=>item.status!=='saved');},
  patchItem(key:number,patch:object){globals.setItems(globals.items.map((item:any)=>item.key===key?{...item,...patch}:item));},
  async uploadAsset(){state.uploads++;if(failure==='upload'&&state.uploads===1)throw new Error('Synthetic upload failure');return {asset:{id:'retained',mime_type:'image/png'},reused:false,upload:null};},
  async request(){state.binds++;if(failure==='binding')throw new Error('Synthetic lost binding response');return {updated_at:'next',assets:[]};},
 };
 globals.remaining=globals.items;
 const code=[findFunction(source,'supportsPurpose'),findFunction(owner,'validate'),findFunction(owner,'submit')].map(node=>node.getText(source)).join('\n')+'\nexports.submit=submit;exports.disabled=()=>('+disabled+');';
 globals.exports={};runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,globals);
 return {state,globals,submit:()=>globals.exports.submit({preventDefault(){}}),disabled:()=>globals.exports.disabled(),
  choose(category:string){globals.category=category;globals.uploadContext={...globals.uploadContext,category};}};
}
for(const category of ['', 'legal_document'])test('project marketing batch rejects private category before bytes, then accepts explicit category: '+(category||'unknown'),async()=>{
 const fixture=projectBatch(category);await fixture.submit();
 expect(fixture.state.uploads).toBe(0);expect(fixture.state.binds).toBe(0);
 expect(fixture.globals.items[0].error).toBe(uploadText.binding_category);
 expect(fixture.disabled()).toBe(false);expect(fixture.globals.attempted).toBe(false);
 fixture.choose('exterior');await fixture.submit();
 expect(fixture.state.uploads).toBe(1);expect(fixture.state.binds).toBe(1);
 expect(fixture.globals.items[0].status).toBe('saved');expect(fixture.disabled()).toBe(true);
});
test('failed upload without a retained asset leaves category editable',async()=>{
 const fixture=projectBatch('exterior','upload');await fixture.submit();
 expect(fixture.state.uploads).toBe(1);expect(fixture.state.binds).toBe(0);expect(fixture.globals.attempted).toBe(true);
 expect(fixture.globals.items[0].asset).toBeUndefined();expect(fixture.disabled()).toBe(false);
 fixture.choose('interior');await fixture.submit();expect(fixture.state.uploads).toBe(2);expect(fixture.state.binds).toBe(1);
 expect(fixture.disabled()).toBe(true);
});
test('retained asset freezes category and preserves required reload after ambiguous bind',async()=>{
 const fixture=projectBatch('exterior','binding');await fixture.submit();
 expect(fixture.globals.items[0].asset.id).toBe('retained');expect(fixture.disabled()).toBe(true);
 expect(fixture.globals.needsReload).toBe(true);await fixture.submit();
 expect(fixture.state.uploads).toBe(1);expect(fixture.state.binds).toBe(1);
});

test('rights evidence renders fixed stock source names and never unknown returned codes',()=>{
 const requireAdmin=createRequire(resolve('apps/admin/package.json'));
 const ts=requireAdmin('typescript') as typeof import('../../apps/admin/node_modules/typescript');
 const React=requireAdmin('react'), {renderToStaticMarkup}=requireAdmin('react-dom/server');
 const source=readFileSync('apps/admin/components/upload-evidence.tsx','utf8'), module={exports:{} as any};
 const known:Record<string,unknown>={'react':React,'react/jsx-runtime':requireAdmin('react/jsx-runtime'),
  '../lib/upload-context':{uploadContextHeader},'../lib/upload-text':{uploadText},
  '../lib/upload-suggestions':{useFileSuggestion,stockEvidenceLabels}};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {module,exports:module.exports,require:(name:string)=>{if(!(name in known))throw new Error('Unexpected dependency '+name);return known[name];}});
 const render=(codes:string[])=>renderToStaticMarkup(React.createElement(module.exports.FileMetadataSuggestions,{
  evidence:{...evidence,suggestions:{source:'file_metadata',confirmed:false,values:{stock:'present',stock_evidence:codes}}}}));
 const html=render(['stock_1','stock_2','stock_3','stock_4','stock_1','unknown-source','<script>unexpected</script>','__proto__']);
 for(const label of [uploadText.stock_1,uploadText.stock_2,uploadText.stock_3,uploadText.stock_4])expect(html).toContain(label);
 for(const value of ['stock_1','unknown-source','unexpected','__proto__'])expect(html).not.toContain(value);
 expect(stockEvidenceLabels(['stock_1','stock_1','unknown'])).toEqual([uploadText.stock_1]);
 const unknown=render(['unknown-source','<script>unexpected</script>']);
 expect(unknown).toContain(uploadText.stock);expect(unknown).not.toContain(uploadText.stock_evidence);
 expect(unknown).not.toContain('<button'); // Evidence alone never applies or confirms metadata.
});
