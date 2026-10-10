import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),base=await mkdtemp(path.resolve('test-results/installer-progress-'));
const compiler='C:/Users/86185/AppData/Local/electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe';
const template=path.resolve('node_modules/app-builder-lib/templates/nsis');
const exe=path.join(base,'progress-test.exe');
await writeFile(path.join(base,'payload.txt'),'Installer progress fixture\n');
const common=await readFile(path.join(template,'common.nsh'),'utf8');
const assisted=await readFile(path.join(template,'assistedInstaller.nsh'),'utf8');
const skip=common.match(/!macro skipPageIfUpdated\s[\s\S]*?!macroend/)?.[0];
const pre=assisted.match(/Function instFilesPre[\s\S]*?FunctionEnd/)?.[0];
if(!skip||!pre)throw Error('Upstream installer callbacks changed');
await writeFile(path.join(base,'upstream-pages.nsh'),`!define APP_FILENAME "EluShellFixtureApp"\n${skip}\n!insertmacro skipPageIfUpdated\n!define MUI_PAGE_CUSTOMFUNCTION_SHOW ObserveDirectory\n!insertmacro MUI_PAGE_DIRECTORY\n!define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre\n${pre}\n`);
await writeFile(path.join(base,'extract-steps.nsh'),Array.from({length:12},(_,i)=>`File /oname=part-${i}.txt "${path.join(base,'payload.txt')}"\nSleep 100\nCall ObserveProgress`).join('\n'));
await promisify(execFile)(compiler,['/INPUTCHARSET','UTF8','/V2',`/DTEST_EXE=${exe}`,`/DTEMPLATE_DIR=${template}`,`/DPRODUCTION_HOOK=${path.join(root,'build/installer.nsh')}`,`/DUPSTREAM_PAGES=${path.join(base,'upstream-pages.nsh')}`,`/DEXTRACT_STEPS=${path.join(base,'extract-steps.nsh')}`,path.resolve('scripts/installer-progress-fixture.nsi')],{windowsHide:true});
const cases=[];
const inputs=[
 ['/S','--updated','--force-run'],
 ['--updated','--force-run'],
 ['--updated','--force-run','--existing-machine'],
 ['--updated','--force-run','/allusers'],
 ['--updated','--force-run','--existing-machine','/currentuser'],
 ['/S'],
 [],
];
for(const args of inputs){
 const dir=path.join(base,`case-${cases.length}`);await mkdir(dir);
 const child=spawn(exe,[...args,`/D=${dir}`],{windowsHide:true,stdio:'ignore'});
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Installer timed out: '+JSON.stringify(args)));},90000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve(code);});});
 if(code!==0)throw Error('Installer exit '+code);
 const samples=(await readFile(path.join(dir,'progress.txt'),'utf8')).trim().split(/\r?\n/).map(line=>line.split(',').map(Number));
 const pages=(await readFile(path.join(dir,'pages.txt'),'utf8')).trim().split(/\r?\n/);
 const [scope,installedPath]=(await readFile(path.join(dir,'installed.txt'),'utf8')).split(/\r?\n/);
 const updated=args.includes('--updated'),silent=args.includes('/S')&&!updated;
 const machine=(args.includes('--existing-machine')||args.includes('/allusers'))&&!args.includes('/currentuser');
 const expectedScope=machine?'all':'CurrentUser';
 const originalPath=path.join(dir,machine?'Machine SSH Tools':'Custom SSH Tools');
 if(scope!==expectedScope)throw Error('Install scope changed');
 const expectedPath=updated||silent?originalPath:path.join(originalPath,'EluShellFixtureApp');
 if(installedPath!==expectedPath)throw Error(`Install path changed: ${installedPath} != ${expectedPath}`);
 if(updated){
  if(pages.join(',')!=='progress')throw Error('Update showed wizard page: '+pages);
  if(!samples.some(s=>s[0]===1&&s[1]===1))throw Error('Update progress window was hidden');
  if(new Set(samples.map(s=>s[2])).size<2)throw Error('Progress did not advance');
  if(await readFile(path.join(dir,'relaunch.txt'),'utf8')!=='complete')throw Error('Successful update did not reach relaunch');
 }else if(silent){
  if(samples.some(s=>s[0]||s[1]))throw Error('Unattended fresh install should remain silent');
 }else if(pages.join(',')!=='scope,directory,progress,finish')throw Error('First-install wizard changed: '+pages);
 if(await readFile(path.join(installedPath,'part-11.txt'),'utf8')!=='Installer progress fixture\n')throw Error('File extraction incomplete');
 cases.push({args,result:'PASS',pages,scope,originalPath,installedPath,visible:!silent,samples});
}
const hash=data=>createHash('sha256').update(data).digest('hex');
const report={result:'PASS',version:JSON.parse(await readFile('package.json','utf8')).version,hookSha256:hash(await readFile('build/installer.nsh')),upstreamSelectionPageSha256:hash(await readFile(path.join(template,'multiUserUi.nsh'))),cases,note:'Native NSIS/MUI harness includes production hooks, actual upstream install-mode page and directory callbacks. Registry scope and UAC are simulated; no registry, shortcuts or personal configuration changed. Updates receive no clicks; first-install fixture advances its retained wizard automatically.'};
await writeFile('test-results/installer-progress.json',JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,version:report.version,cases:cases.map(({args,pages,scope})=>({args,pages,scope}))},null,2));
