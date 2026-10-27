import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {extractSenaProject} from '../scripts/sena-project-extract.mjs';

async function extract(html) {
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});
    await context.route('**/*',route=>route.abort());
    const page=await context.newPage();
    await page.setContent(html,{waitUntil:'domcontentloaded'});
    return await page.evaluate(extractSenaProject);
  } finally {await browser.close();}
}

test('main project template extracts all inert plans, explicit rooms and source labels',async()=>{
  const floor=[{project_floor_plan:{th:'ชั้น 2–5'},project_floor_plan_building_name:{th:'อาคาร A'},floor_plan_image_url:['/floor-a.webp']},
    {project_floor_plan:{th:'ดาดฟ้า'},project_floor_plan_building_name:{th:'อาคาร A'},floor_plan_image_url:['/roof.webp']}];
  const units=[{project_unit_type:{th:'แบบ A'},project_unit_type_size:'30.5 ตร.ม.',unit_type_image_url:['/type-a.webp'],
    project_detail_unit_type_room_list:[{project_room_unit_type:{th:'ห้องนอน'},project_room_unit_type_count:'1'}]},
    {project_unit_type:{th:'แบบ B'},project_unit_type_size:'40–45 ตร.ม.',unit_type_image_url:['/type-b.webp']}];
  const value=await extract(`<title>โครงการจำลอง</title><main id="wrapperProjectDetail">
    <div id="tab-project-detail-0"><h2>แนวคิดจำลอง</h2><p>อยู่ใกล้สวน</p></div>
    <div id="tab-project-detail-1"><div><div><div class="title-in-tab-data-project-detail">facilities</div></div><div><div class="text-tab-data-project-detail">สระว่ายน้ำ<br>สวน</div></div></div></div>
    <section><h3>ชั้น 5</h3><ul class="facility-list"><li>ฟิตเนส</li><li>สวนลอยฟ้า</li></ul></section>
    <div class="wrapper-near-location"><h3>การเดินทาง</h3><div class="near-location-detail">สถานีจำลอง 500 ม.<br>ถนนตัวอย่าง</div></div>
    <div class="location-content"><h4>Call Center 1775 #99</h4><h4>ถนนทดสอบ แขวงทดสอบ</h4></div>
    <a href="tel:1775">โทร</a><a href="https://lin.ee/synthetic">LINE โครงการ</a>
    <button id="gallery-facility">ส่วนกลาง</button><div role="tabpanel" aria-labelledby="gallery-facility" id="gallery-panel"><img data-src="/pool.webp" alt="สระว่ายน้ำ"></div>
    <iframe src="https://www.youtube.com/embed/12345678901" title="ชมโครงการ"></iframe>
    <a href="https://my.matterport.com/show/?m=synthetic">ชมห้อง A</a><a href="/brochure.pdf">โบรชัวร์</a><img src="/map.webp" alt="แผนที่">
    <div class="progress-detail"><div class="row">งานโครงสร้าง <span>85%</span></div><div class="row">งานระบบ <span>40%</span></div></div>
    <div class="condition-project"><h3>รายละเอียดและเงื่อนไข</h3><p>ข้อมูล สคบ. จำลอง</p></div>
    <div class="promotion-terms"><h3>เงื่อนไขโปรโมชั่น</h3><p>เงื่อนไขจำลอง</p></div>
    <div class="accordion-item"><h3 class="accordion-header"><button>โครงการอยู่ที่ไหน</button></h3><div class="accordion-body">ถนนทดสอบ</div></div>
    <form><p>ห้ามนำข้อมูลผู้ลงทะเบียนเข้า</p><a href="mailto:lead@example.test">LEAD</a></form>
    <script>var dataFloorPlan=${JSON.stringify(floor)};var dataUnitType=${JSON.stringify(units)};document.body.innerHTML='EXECUTED';</script>
    </main><footer><img src="/logo.svg">ลิงก์ส่วนท้าย</footer>`);
  const w=value.website;
  assert.equal(w.concept_name,'แนวคิดจำลอง');
  assert.equal(w.project_information[0].label,'facilities');
  assert.deepEqual(w.facilities.map(f=>f.name),['สระว่ายน้ำ','สวน','ฟิตเนส','สวนลอยฟ้า']);
  assert.equal(w.facilities[2].location_label,'ชั้น 5');
  assert.deepEqual(w.floor_plans.map(f=>f.label),['ชั้น 2–5','ดาดฟ้า']);
  assert.equal(w.floor_plans[0].building_label,'อาคาร A');
  assert.deepEqual(w.unit_types.map(t=>t.size_text),['30.5 ตร.ม.','40–45 ตร.ม.']);
  assert.deepEqual(w.unit_types[0].rooms,[{label:'ห้องนอน',count_text:'1'}]);
  assert.equal(w.unit_plans[1].type_label,'แบบ B');
  assert.equal(w.gallery.find(g=>g.url==='/pool.webp').gallery_tab,'ส่วนกลาง');
  assert.equal(w.nearby[0].heading,'การเดินทาง');
  assert.equal(w.nearby[0].text,'สถานีจำลอง 500 ม.');
  assert.deepEqual(w.call_centres,['Call Center 1775 #99']);
  assert.equal(w.contacts.length,2);
  assert.equal(w.videos.length,1);assert.equal(w.tours.length,1);
  assert.equal(w.tours[0].label,'ชมห้อง A');assert.equal(w.tours[0].metadata_source,'manual');
  assert.equal(w.brochures.length,1);assert.equal(w.maps.length,1);
  assert.deepEqual(w.construction.map(c=>[c.component_label,c.percent_text,c.as_of]),[['งานโครงสร้าง','85',null],['งานระบบ','40',null]]);
  assert.match(w.disclosures[0].text,/สคบ/);assert.equal(w.promotion_terms.length,1);
  assert.equal(w.faqs[0].answer,'ถนนทดสอบ');
  assert.doesNotMatch(JSON.stringify(value),/EXECUTED|ห้ามนำข้อมูลผู้ลงทะเบียนเข้า|lead@example|logo\.svg/);
  assert.equal(w.extraction_gaps.length,0);
});

test('WordPress Elementor tabs retain hidden types, gallery labels and nested FAQ pairs',async()=>{
  const value=await extract(`<main id="content"><div class="e-con e-parent"><div id="concept"><h2>แนวคิดบ้านจำลอง</h2></div><p>บ้านใกล้ธรรมชาติ</p></div>
    <div class="e-con e-parent"><h2 id="project-info">PROJECT INFORMATION</h2><img src="/information.jpg"></div>
    <div class="e-con e-parent"><span class="elementor-icon-list-text">จำนวนยูนิต    50 หลัง</span><span class="elementor-icon-list-text">Fitness Room</span><div class="_df_thumb" id="df_123">โบรชัวร์จำลอง</div></div>
    <div class="e-con"><h3 class="elementor-heading-title">การเดินทาง</h3><p>สถานีตัวอย่าง 1.2 กม.</p></div>
    <button id="unit-a">แบบ A</button><div role="tabpanel" aria-labelledby="unit-a" id="unit-panel-a"><h3>TYPE: A</h3><p>180 SQ.M.</p><p>3 BED ROOM</p><p>2 BATH ROOM</p><img src="/unit-plan-a.webp" alt="แปลนชั้น 1"></div>
    <button id="unit-b">แบบ B</button><div role="tabpanel" aria-labelledby="unit-b" id="unit-panel-b" hidden><h3>TYPE: B</h3><p>220 SQ.M.</p><p>4 BED ROOM</p><img src="/unit-plan-b.webp" alt="แปลนชั้น 2"></div>
    <button id="exterior-tab">Exterior</button><div role="tabpanel" aria-labelledby="exterior-tab" id="gallery-exterior"><a href="/house.webp"><div data-thumbnail="/house-small.webp"></div></a></div>
    <div class="elementor-widget-video" data-settings='{"youtube_url":"https://www.youtube.com/watch?v=12345678901"}'></div>
    <details class="e-n-accordion-item" id="faq-house"><summary>มีกี่แบบบ้าน</summary><div>มีแบบ A และ B</div></details>
    <div class="elementor-location-footer"><img src="/chrome.webp">ส่วนท้าย</div>
    <script>window.option_df_123={"source":"https://brands.sena.co.th/synthetic.pdf"};document.body.innerHTML='EXECUTED';</script>
    </main>`);
  const w=value.website;
  assert.equal(w.concept,'แนวคิดบ้านจำลอง บ้านใกล้ธรรมชาติ');
  assert.equal(w.project_information[0].value,'50 หลัง');assert.equal(w.facilities[0].name,'Fitness Room');
  assert.equal(w.brochures[0].url,'https://brands.sena.co.th/synthetic.pdf');
  assert.equal(w.unit_types.length,2);assert.match(w.unit_types[1].detail,/220 SQ.M/);
  assert.deepEqual(w.unit_plans.map(p=>p.type_label),['TYPE: A','TYPE: B']);
  assert.equal(w.nearby[0].heading,'การเดินทาง');assert.match(w.nearby[0].text,/1.2 กม/);
  assert.ok(w.gallery.some(g=>g.gallery_tab==='Exterior'&&g.url==='/house-small.webp'));
  assert.equal(w.videos.length,1);
  assert.equal(w.faqs[0].answer,'มีแบบ A และ B');
  assert.doesNotMatch(JSON.stringify(value),/chrome\.webp|ส่วนท้าย/);
});

test('invalid public content JSON records a gap and never evaluates code',async()=>{
  const value=await extract('<main><h1>ทดสอบ</h1><p>เนื้อหาจำลอง</p></main><script>var dataFloorPlan=[{url:danger()}];var userData=[{"name":"PRIVATE"}];</script>');
  assert.deepEqual(value.website.floor_plans,[]);
  assert.deepEqual(value.website.extraction_gaps,[{field:'dataFloorPlan',reason:'content_json_invalid'}]);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE|danger/);
});
