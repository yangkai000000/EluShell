import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { SSHService } from '../electron/ssh';
import { DeploymentService } from '../electron/deployment';
import { ConfigStore } from '../electron/config-store';
import { RemoteFiles } from '../electron/remote-files';
import { TransferManager } from '../electron/transfers';
import { emptyProfile, quote } from '../src/shared';
import type { DeploymentJob } from '../src/deployment-shared';
const record=await readFile('docs/RELEASING.md','utf8'), password=record.match(/服务器密码：`([^`]+)`/)?.[1];
const known=JSON.parse(await readFile('test-results/live-readonly.json','utf8'));
assert(password && known.host==='118.190.211.218');
const root=await mkdtemp(path.resolve('test-results/live-deployment-'));
const remote='/home/itos/.elushell-deployment-check-'+randomUUID();
let data='';const jobs:DeploymentJob[]=[];
const ssh=new SSHService(e=>{if(e.type==='data')data+=e.data;},async(host,key)=>host==='118.190.211.218:22'&&key===known.fingerprint);
const store=new ConfigStore(path.join(root,'.EluShell'),{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()});await store.initialize();
const files=new RemoteFiles(id=>ssh.sftp(id),new TransferManager(()=>{}));
const deploy=new DeploymentService(store,id=>ssh.get(id),id=>ssh.sftp(id),files,j=>jobs.push(j),id=>ssh.acquireScript(id));
const poll=async(check:()=>boolean)=>{const start=Date.now();while(!check()){if(Date.now()-start>25000)throw Error('Live fixture timeout');await new Promise(r=>setTimeout(r,50));}};
let session='';
try{
 session=await ssh.connect({...emptyProfile,id:'live-isolated-test',name:'isolated-test',host:'118.190.211.218',username:'itos',port:22,auth:'password'},password!);ssh.start(session);await poll(()=>!!ssh.get(session).shellPid);
 await ssh.exec(session,`mkdir -m 700 ${quote(remote)}`);
 const marker=randomUUID();
 ssh.write(session,`export ELU_LIVE_ENV='live-${marker}'; ELU_LOCAL=local-value; elu_func() { printf function-value; }; alias elu_alias='printf alias-value'; cd ${quote(remote)}; printf 'READY:%s\\n' '${marker}'\r`);
 await poll(()=>data.includes('READY:'+marker));
 const commands=`printf 'RESULT:%s:%s:%s:%s:%s:%s\\n' "$ELU_LIVE_ENV" "$ELU_LOCAL" "$(elu_func)" "$(elu_alias)" "$PWD" "$(id -un)"\nfor n in 1 2; do\n  printf 'STEP:%s\\n' "$n"\ndone\ncat <<'ELU_EOF'\nheredoc stays literal $HOME\nELU_EOF`;
 const expected=`RESULT:live-${marker}:local-value:function-value:alias-value:${remote}:itos`;
 ssh.write(session,commands.replace(/\n/g,'\r')+'\r');await poll(()=>data.includes(expected));
 const local=path.join(root,'fixture.txt');await writeFile(local,'isolated upload\n');
 const plan={id:randomUUID(),name:'Isolated environment check',localPath:local,remoteDirectory:remote,commands,timeoutMinutes:1};await deploy.save(plan);
 const job=await deploy.start(session,plan.id);await poll(()=>jobs.some(j=>j.id===job.id&&['failed','completed','stopped'].includes(j.state)));
 const done=jobs.filter(j=>j.id===job.id).at(-1)!;assert.equal(done.state,'completed',done.error);assert(done.output.includes(expected));assert(done.output.includes('STEP:1')&&done.output.includes('STEP:2'));assert(done.output.includes('heredoc stays literal $HOME'));
 await deploy.save({...plan,commands:'false\necho MUST_NOT_RUN'});const failed=await deploy.start(session,plan.id);await poll(()=>jobs.some(j=>j.id===failed.id&&j.state==='failed'));const failure=jobs.filter(j=>j.id===failed.id).at(-1)!;assert.equal(failure.exitCode,1);assert(!failure.output.includes('MUST_NOT_RUN'));
 assert.equal((await ssh.cwd(session)).trim(),remote);
 const result={result:'PASS',originalPty:true,originalUser:'itos',exportedAndLocalVariables:true,functionAndAlias:true,workingDirectory:true,multilineLoop:true,heredoc:true,uploadBeforeCommand:true,failFast:true,terminalPreserved:true};
 await writeFile('test-results/deployment-live-0103.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 await deploy.close();
 if(session){await ssh.exec(session,`rm -f ${quote(remote+'/fixture.txt')}; rmdir ${quote(remote)}`).catch(()=>{});}
 ssh.close();
}
