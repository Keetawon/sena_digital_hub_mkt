"""Scoped, extractive knowledge preview. Draft sources can never enter a public answer."""
from __future__ import annotations
import hashlib, math, os, re, unicodedata
from pythainlp.tokenize import word_tokenize
from .provider_budget import ProviderBudgetExceeded, spend_limit_code

EMBED_MODEL='text-embedding-3-large'
DIMENSIONS=1536
STATUS={0:'พรีเซล',1:'กำลังก่อสร้าง',2:'พร้อมอยู่',3:'ปิดโครงการ'}
INJECTION=re.compile(r'ignore.{0,60}(?:instruction|prompt|rule)|(?:system|developer|assistant)\s*:|(?:reveal|print).{0,40}(?:secret|token|key)|(?:เพิกเฉย|ละเว้น|ไม่ต้องทำตาม).{0,40}(?:คำสั่ง|กฎ)|(?:เปิดเผย|ส่ง).{0,30}(?:รหัสผ่าน|โทเคน)',re.I)
COMMERCIAL=re.compile(r'ราคา|โปรโมชั่น|โปรโมชัน|ส่วนลด|ค่าส่วนกลาง|ค่าเช่า|ดอกเบี้ย|ผ่อน|เงินดาวน์|เงินจอง|เงินประกัน|บาท|ล้านบาท|(?:price|promotion|discount|fee|deposit|rent|interest)\b',re.I)
AVAILABILITY=re.compile(r'ห้องว่าง|ยูนิตว่าง|เหลือกี่|เหลือห้อง|ยังว่าง|มีห้องเหลือ|availability|available units|in stock',re.I)
PRICE=re.compile(r'ราคา|starting price|cost|price',re.I)
NUMERIC=re.compile(r'\d|[๐-๙]|เปอร์เซ็นต์|ร้อยละ')

def normalize(text):return ' '.join(unicodedata.normalize('NFC',text).casefold().split())
def keywords(text):return sorted({normalize(x) for x in word_tokenize(text,engine='newmm') if len(x.strip())>1})
def safe_text(text):
    kept=[];holds=[]
    for line in text.splitlines():
        if INJECTION.search(line):holds.append('prompt_injection')
        elif COMMERCIAL.search(line):holds.append('commercial_text')
        elif NUMERIC.search(line):holds.append('numeric_claim')
        elif line.strip():kept.append(line.strip())
    return '\n'.join(kept),sorted(set(holds))

def cosine(a,b):
    if len(a)!=len(b) or not a:return 0.0
    denom=math.sqrt(sum(x*x for x in a)*sum(x*x for x in b))
    return sum(x*y for x,y in zip(a,b))/denom if denom else 0.0

def rank(rows,query_embedding,query):
    terms=set(keywords(query));scored=[]
    for row in rows:
        score=cosine(row['embedding'],query_embedding)
        overlap=len(terms & set(row['keywords'])) / max(1,len(terms))
        scored.append({**row,'cosine':score,'keyword_score':overlap})
    vectors=sorted(scored,key=lambda r:r['cosine'],reverse=True)
    lexical=sorted((r for r in scored if r['keyword_score']>0),key=lambda r:r['keyword_score'],reverse=True)
    rr={str(r['id']):1/(60+i) for i,r in enumerate(vectors,1)}
    for i,r in enumerate(lexical,1):rr[str(r['id'])]+=1/(60+i)
    for r in scored:r['rrf']=rr[str(r['id'])]
    return sorted(scored,key=lambda r:r['rrf'],reverse=True)

async def embed(texts):
    from openai import AsyncOpenAI
    if not os.environ.get('OPENAI_API_KEY','').strip():raise RuntimeError('embedding_provider_not_configured')
    async with AsyncOpenAI(base_url='https://api.openai.com/v1',timeout=45,max_retries=0) as client:
        try:
            response=await client.embeddings.create(model=EMBED_MODEL,dimensions=DIMENSIONS,input=texts)
        except Exception as error:
            if code := spend_limit_code(error):
                raise ProviderBudgetExceeded(code) from None
            raise
        return [x.embedding for x in sorted(response.data,key=lambda x:x.index)]

def route_question(question,card):
    raw=card.get('status',{}).get('raw')
    if raw==3:return ('closed','โครงการระยะนี้ปิดโครงการแล้ว (สถานะ REM: 3) ไม่แสดงเป็นโครงการที่กำลังขาย กรุณาติดต่อฝ่ายขายเพื่อสอบถามโครงการระยะอื่น')
    if card and card.get('model_catalogue_complete') is not True and re.search(r'แบบห้อง|แบบบ้าน|ห้องนอน|ห้องน้ำ|พื้นที่ใช้สอย|bedroom|bathroom|unit type|room type|floor plan',question,re.I):
        return ('model_catalogue_handoff','ยังไม่มีข้อมูลแบบห้องที่ยืนยันครบ กรุณาติดต่อทีมโครงการเพื่อยืนยันแบบและรายละเอียด')
    if INJECTION.search(question):return ('unsafe_instruction','ไม่สามารถทำตามคำสั่งที่ให้เปิดเผยข้อมูลภายในหรือข้ามกติกาได้')
    if re.search(r'(?:เบอร์|ชื่อ|ที่อยู่|ข้อมูล).{0,20}(?:ผู้เช่า|ลูกค้า|บุคคล).{0,10}(?:อื่น|รายอื่น)|personal data|tenant phone',question,re.I):return ('private_request','ไม่สามารถค้นหรือเปิดเผยข้อมูลส่วนบุคคลของผู้อื่นได้')
    if re.search(r'โซลาร์|solar|GSB',question,re.I):
        if card.get('name'):return ('owner_review_handoff','คุณสมบัติด้านพลังงานของโครงการยังรอเจ้าของข้อมูลยืนยัน กรุณาติดต่อทีมโครงการ')
        return ('deferred_solar','ข้อมูล SENA Solar อยู่นอกขอบเขตระยะนี้ กรุณาติดต่อทีม Solar')
    if AVAILABILITY.search(question):return ('sales_handoff','กรุณาติดต่อฝ่ายขายเพื่อตรวจสอบห้องว่างล่าสุด ระบบนี้ไม่ยืนยันจำนวนห้องว่าง')
    if PRICE.search(question):return ('price_handoff','ยังไม่มีราคาเริ่มต้นที่เจ้าของข้อมูลยืนยันพร้อมวันที่อ้างอิงและช่วงใช้ได้ กรุณาติดต่อฝ่ายขาย')
    if re.search(r'คำนวณ|คำนวน|calculate|calculator|ผ่อน.*(?:เท่าไร|เท่าไหร่)|เครดิต.*(?:เท่าไร|เท่าไหร่)',question,re.I):return ('rules_only_handoff','ระบบระยะนี้ไม่คำนวณวงเงินหรือผลตอบแทน กรุณาให้เจ้าหน้าที่อธิบายกติกาที่อนุมัติพร้อมแหล่งอ้างอิง')
    if COMMERCIAL.search(question) or re.search(r'livnex|rentnex|ลิฟเน็กซ์|เรนท์เน็กซ์|เช่าออม|แกรนด์โฮม.*(?:85|38)|\d+\s*%',question,re.I):return ('owner_review_handoff','เงื่อนไขนี้ต้องให้เจ้าของข้อมูลยืนยันกติกา ช่วงเวลา และโครงการที่ใช้ได้ก่อน กรุณาติดต่อเจ้าหน้าที่')
    return None

def answer_from_ranked(ranked):
    # Question variants compete as one FAQ, never as separate close competitors.
    faqs={}
    for row in ranked:
        if row['kind']=='faq' and (str(row['candidate_id']) not in faqs or row['cosine']>faqs[str(row['candidate_id'])]['cosine']):faqs[str(row['candidate_id'])]=row
    ordered=sorted(faqs.values(),key=lambda r:r['cosine'],reverse=True)
    if ordered and ordered[0]['cosine']>=0.88 and (len(ordered)==1 or ordered[0]['cosine']-ordered[1]['cosine']>=0.05):
        selected=[ordered[0]];text=ordered[0]['evidence']['short_answer']['th'];mode='faq'
    else:
        selected=[r for r in ranked if r['kind']=='section' and r['cosine']>=0.45][:5]
        text='\n\n'.join(r['chunk_text'] for r in selected);mode='sections'
    if not selected:return {'route':'no_answer','answer':'ยังไม่มีข้อมูลที่ยืนยันคำตอบนี้ได้ กรุณาติดต่อเจ้าหน้าที่','citations':[],
        'retrieved':[{'candidate_id':str(r['candidate_id']),'cosine':r['cosine'],'rrf':r['rrf']} for r in ranked[:5]]}
    return {'route':mode,'answer':text,'citations':[{'candidate_id':str(r['candidate_id']),'source_url':r['source_url'],'source_ref':r['source_ref'],'batch_sha256':r['batch_sha256'],'preview':True} for r in selected],
        'retrieved':[{'candidate_id':str(r['candidate_id']),'cosine':r['cosine'],'rrf':r['rrf']} for r in ranked[:5]]}
