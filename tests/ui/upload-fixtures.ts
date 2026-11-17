import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { uploadContextHeader, type UploadContext } from '../../apps/admin/lib/upload-context';
export const uploadHeaders = (context: UploadContext) => ({ 'X-Upload-Context': uploadContextHeader(context) });
export const projectUpload = (ref: string, category: string | null = 'exterior', purpose = 'media') =>
  uploadHeaders({ v: 1, kind: 'project', ref, category, purpose });

export const uploadEvidenceFixture = {
 source_id:'66000000-0000-4000-8000-000000000020', evidence_id:'66000000-0000-4000-8000-000000000021',
 original:{size:2048,mime_type:'image/png',width:640,height:320},stored:{size:1024,mime_type:'image/png',width:640,height:320},
 pipeline_version:'synthetic-v1',extraction_version:'synthetic-v1',processing:{metadata_stripped:true},
 suggestions:{source:'file_metadata' as const,confirmed:false as const,values:{caption:'Synthetic file caption',credit:'Synthetic copyright',
 taken_at:{value:'2020-01-02T03:04:05',offset_known:false},image_kind:'render' as const,unmapped_keywords:['Unmapped word']}}
};

export function syntheticPrivatePng() {
 const chunk=(type:string,data:Buffer)=>{
  const value=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of value){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}
  const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,value,sum]);
 };
 const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat([Buffer.from([0]),randomBytes(3)]))),chunk('IEND',Buffer.alloc(0))]);
}
