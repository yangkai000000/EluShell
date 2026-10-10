import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
const url='https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable/26.2.6/win/x86_64/LibreOffice_26.2.6_Win_x86-64.msi';
const size=373252096, count=6, width=Math.ceil(size/count);
const parts=await Promise.all(Array.from({length:count},async(_,i)=>{
  const begin=i*width,end=Math.min(size-1,begin+width-1);
  const response=await fetch(url,{headers:{Range:`bytes=${begin}-${end}`},signal:AbortSignal.timeout(300000)});
  if(response.status!==206)throw Error('Range download unavailable: '+response.status);
  const file=`test-results/document-runtime/part-${i}`;
  await pipeline(Readable.fromWeb(response.body),createWriteStream(file));console.log('Document runtime part complete',i+1);return file;
}));
async function* chunks(){for(const file of parts)yield* createReadStream(file);}
await pipeline(Readable.from(chunks()),createWriteStream('test-results/document-runtime/LibreOffice-parallel.msi'));
console.log('Document runtime assembled');
