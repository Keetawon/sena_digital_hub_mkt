import { progressFixture } from './progress-fixture';
import { test, expect } from '@playwright/test';

test('staff project thumbnails use project, brand, then initials and recover from an unavailable image', async ({page}) => {
  await page.context().addCookies([{name:'sena_local_persona',value:'viewer',url:'http://127.0.0.1:3000'}]);
  const image={id:'project-image',public_url:null},logo={id:'brand-logo',public_url:null};
  const base={public_project_id:null,brand_name:'ทดสอบ',new_from_rem:true,filling:false,published:false,needs_attention:false,attention:[],gaps:{core:[],media:[],models:[],brand:[]},confirmed_models:0,total_models:0,waiting_on:['editor'],amenities:null,updated_at:null,age_days:null,first_seen_at:null,age_basis:'unknown'};
  const rows=[{name:'ภาพโครงการ',thumbnail:image,brand_logo:logo},{name:'โลโก้แทนภาพ',thumbnail:null,brand_logo:logo},{name:'ชื่อย่อ',thumbnail:null,brand_logo:null},{name:'ภาพเสีย',thumbnail:{id:'broken',public_url:null},brand_logo:logo}].map((r,i)=>({...base,...r,rem_project_id:String(i)}));
  await page.route('**/api/hub/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.includes('/assets/')) {
      if(path.includes('broken')) return route.fulfill({status:404});
      return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
    }
    return route.fulfill({json:{data:path.endsWith('/projects/progress')? progressFixture(route.request().url(), rows) :[]}});
  });
  await page.goto('/');
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
