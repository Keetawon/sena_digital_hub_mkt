import { projectUpload } from "./upload-fixtures";
import { progressFixture } from './progress-fixture';
import { test, expect } from '@playwright/test';

test('uploaded SVG appears as a private WebP list thumbnail on the neutral tile', async ({page}) => {
  await page.context().addCookies([{name:'sena_local_persona',value:'editor',url:'http://127.0.0.1:3000'}]);
  const projects = (await (await page.request.get('/api/hub/v1/admin/projects')).json()).data;
  const owner = projects.find((item: {source: {rem_project_id: string}}) => item.source.rem_project_id === 'DEMO-001');
  expect(owner).toBeTruthy();
  const response=await page.request.post('/api/hub/v1/admin/assets',{
    headers:{...projectUpload(owner.public_project_id),Origin:'http://127.0.0.1:3000','Content-Type':'image/svg+xml','X-Filename':'thumbnail-test.svg'},
    data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect x="100" y="50" width="200" height="100" fill="red"/></svg>'),
  });
  expect(response.ok()).toBe(true);
  const asset=(await response.json()).data;
  const derivative=await page.request.get(`/api/hub/v1/admin/assets/${asset.id}/thumbnail`);
  expect(derivative.headers()['content-type']).toBe('image/webp');
  const rows=[{rem_project_id:'SVG-TEST',public_project_id:null,name:'โลโก้เวกเตอร์ทดสอบ',brand_name:null,
    thumbnail:{id:asset.id,public_url:null},brand_logo:null,new_from_rem:true,filling:false,published:false,needs_attention:false,
    attention:[],gaps:{core:[],media:[],models:[],brand:[]},confirmed_models:0,total_models:0,waiting_on:['editor'],
    amenities:null,updated_at:null,age_days:null,first_seen_at:null,age_basis:'unknown'}];
  await page.route('**/api/hub/v1/admin/projects/progress**',route=>route.fulfill({json:{data:progressFixture(route.request().url(),rows)}}));
  await page.goto('/?view=projects');
  const image=page.getByRole('img',{name:'โลโก้เวกเตอร์ทดสอบ',exact:true});
  await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveJSProperty('naturalWidth',96);
  await expect(image).toHaveJSProperty('naturalHeight',48);
  await expect(image).toHaveAttribute('src',new RegExp(`${asset.id}/thumbnail$`));
  await expect(image.locator('..')).toHaveCSS('background-color','rgb(237, 241, 237)');
});

test('staff project thumbnails use project, brand, then initials and recover from an unavailable image', async ({page}) => {
  await page.context().addCookies([{name:'sena_local_persona',value:'viewer',url:'http://127.0.0.1:3000'}]);
  const image={id:'project-image',public_url:null},logo={id:'brand-logo',public_url:null};
  const base={public_project_id:null,brand_name:'ทดสอบ',new_from_rem:true,filling:false,published:false,needs_attention:false,attention:[],gaps:{core:[],media:[],models:[],brand:[]},confirmed_models:0,total_models:0,waiting_on:['editor'],amenities:null,updated_at:null,age_days:null,first_seen_at:null,age_basis:'unknown'};
  const rows=[{name:'ภาพโครงการ',thumbnail:image,brand_logo:logo},{name:'โลโก้แทนภาพ',thumbnail:null,brand_logo:logo},{name:'ชื่อย่อ',thumbnail:null,brand_logo:null},{name:'ภาพเสีย',thumbnail:{id:'broken',public_url:null},brand_logo:logo}].map((r,i)=>({...base,...r,rem_project_id:String(i)}));
  await page.route('**/api/hub/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/hub/v1/me')return route.continue();
    if(path.includes('/assets/')) {
      if(path.includes('broken')) return route.fulfill({status:404});
      return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
    }
    return route.fulfill({json:{data:path.endsWith('/projects/progress')? progressFixture(route.request().url(), rows) :[]}});
  });
  await page.goto('/?view=projects');
  await expect(page.getByRole('img',{name:'ภาพโครงการ',exact:true})).toHaveAttribute('src',/project-image\/thumbnail$/);
  await expect(page.getByRole('img',{name:'โลโก้แทนภาพ',exact:true})).toHaveAttribute('src',/brand-logo/);
  await expect(page.getByRole('img',{name:'ชื่อย่อ',exact:true})).toHaveText('ชื');
  const broken=page.getByRole('img',{name:'ภาพเสีย',exact:true}); await broken.scrollIntoViewIfNeeded();
  await expect(broken).toHaveAttribute('src',/brand-logo/);
  const first=page.getByRole('img',{name:'ภาพโครงการ',exact:true});
  await expect(first).toHaveAttribute('loading','lazy');
  expect((await first.boundingBox())!.width).toBe(48);
  expect((await first.boundingBox())!.height).toBe(48);
});
