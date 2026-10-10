import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
const url='https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable/26.2.6/win/x86_64/LibreOffice_26.2.6_Win_x86-64.msi';
const response=await fetch(url,{signal:AbortSignal.timeout(600000)});
if(!response.ok)throw Error('Download failed '+response.status);
let bytes=0,last=0;
await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes-last>30*1024*1024){console.log('Document runtime downloaded MB:',Math.round(bytes/1024/1024));last=bytes;}done(null,chunk);}}),createWriteStream('test-results/document-runtime/LibreOffice.msi'));
console.log('Download complete',bytes);
