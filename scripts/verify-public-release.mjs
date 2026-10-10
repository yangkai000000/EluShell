import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=new URL(process.argv[2]), version=JSON.parse(await readFile('package.json','utf8')).version;
if(!/^https?:$/.test(base.protocol)||!base.pathname.endsWith('/'))throw Error('Expected release directory URL');
const manifest=JSON.parse(await readFile(`artifacts/release-${version}/manifest.json`,'utf8'));
const checks=[];
const metadataOnly=process.argv.includes('--metadata');
for(const relative of ['index.html',`guide/${manifest.guideVersion}/index.html`]){
  const response=await fetch(new URL(relative,base),{signal:AbortSignal.timeout(20000)});
  const body=await response.text();
  if(!response.ok||!body.includes(`name="elushell-version" content="${relative.startsWith('guide/') ? manifest.guideVersion : version}"`)||!body.includes('联系开发人员反馈：杨凯'))throw Error('Public page mismatch: '+relative);
  checks.push({path:relative,result:'PASS'});
}
for(const file of manifest.files.filter(f=>/\.(exe|zip|docx|pdf)$/.test(f.path))){
  if(metadataOnly){
    const url=new URL(file.path,base);
    const head=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(20000)});
    if(!head.ok||Number(head.headers.get('content-length'))!==file.size)throw Error('Public size mismatch: '+file.path);
    const range=await fetch(url,{headers:{Range:'bytes=0-63'},signal:AbortSignal.timeout(20000)});
    const bytes=Buffer.from(await range.arrayBuffer());
    const magic=file.path.endsWith('.exe')?'MZ':file.path.endsWith('.pdf')?'%PDF':'PK';
    if(range.status!==206||bytes.length!==64||!range.headers.get('content-range')?.endsWith('/'+file.size)||!bytes.toString().startsWith(magic))throw Error('Public range download mismatch: '+file.path);
    checks.push({path:file.path,result:'PASS',method:'Public HEAD size and range/magic check; full hashes verified separately by server HTTP report'});
    continue;
  }
  const response=await fetch(new URL(file.path,base),{signal:AbortSignal.timeout(300000)});
  if(!response.ok||!response.body)throw Error('Public download failed: '+file.path);
  const hash=createHash('sha256');let size=0;
  for await(const chunk of response.body){hash.update(chunk);size+=chunk.length;}
  if(size!==file.size||hash.digest('hex')!==file.sha256)throw Error('Public file checksum mismatch: '+file.path);
  checks.push({path:file.path,result:'PASS',method:'Full HTTP download SHA256'});
  console.log('Verified '+file.path);
}
const feedResponse=await fetch(new URL('windows/x64/latest.yml',base));
const feed=await feedResponse.json();
const expectedFeed=JSON.parse(await readFile('release/latest.yml','utf8'));
if(!feedResponse.ok||feed.version!==version||feed.sha512!==expectedFeed.sha512||feed.releaseNotes!==expectedFeed.releaseNotes)throw Error('Public update feed mismatch');
const record=await (await fetch(new URL(`releases/${version}.json`,base))).json();
if(record.version!==version||record.files.length!==manifest.files.length)throw Error('Public manifest mismatch');
await writeFile(metadataOnly?'test-results/public-release-metadata.json':'test-results/public-release.json',JSON.stringify({result:'PASS',version,base:base.href,checks,feed:true},null,2));
console.log(JSON.stringify({result:'PASS',version,checks:checks.length,feed:true}));
