import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import ssh2 from 'ssh2';
await build({entryPoints:['electron/processes.ts'],bundle:true,platform:'node',format:'cjs',outfile:'test-results/process-parser.cjs'});
const {processCommand,parseProcesses,identityCommand}=createRequire(import.meta.url)(path.resolve('test-results/process-parser.cjs'));
const known=JSON.parse(await readFile('test-results/live-readonly.json','utf8'));
console.log('Ready for credentials on raw stdin; read-only process verification.');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=await new Promise(r=>process.stdin.once('data',d=>r(JSON.parse(d.toString()))));
const client=new ssh2.Client();
try{
 await new Promise((resolve,reject)=>{client.on('error',reject).on('ready',resolve);client.connect({host:known.host,username:known.user,password:input.password,hostHash:'sha256',hostVerifier:key=>key===known.fingerprint,readyTimeout:15000});});input.password='';
 const exec=command=>new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Read-only process query timed out')),12000);client.exec(command,(err,s)=>{if(err){clearTimeout(timer);reject(err);return;}s.on('data',d=>output+=d.toString());s.on('close',()=>{clearTimeout(timer);resolve(output)});});});
 const started=Date.now(),raw=await exec(processCommand),rows=parseProcesses(raw);if(!rows.length)throw Error('No processes parsed');const p=rows.find(p=>p.user===known.user&&p.name==='java')||rows.find(p=>p.pid>1);const identity=await exec(identityCommand(p.pid));if(!identity.startsWith(p.start+'\t'))throw Error('Process identity check failed');
 const jars=rows.filter(p=>p.locationSource==='entry'&&p.location.endsWith('.jar'));if(!jars.length)throw Error('No Java service JAR locations identified');
 const javaRows=rows.filter(p=>p.name==='java');if(javaRows.some(p=>p.cwd&&p.command.includes(' -jar ')&&p.locationSource!=='entry'))throw Error('Readable Java JAR process was not resolved');
 const report={javaProcesses:javaRows.length,javaLocationSources:javaRows.reduce((a,p)=>(a[p.locationSource]=(a[p.locationSource]||0)+1,a),{}),withServiceJar:jars.length,withCwd:rows.filter(p=>p.cwd).length,result:'PASS',count:rows.length,withExecutable:rows.filter(p=>p.executable).length,durationMs:Date.now()-started,checks:['read-only full process query on authorized Linux host','process start-time identity','no terminate command sent','real Java service JAR locations resolved']};await writeFile('test-results/live-processes-v041.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{client.end();process.stdin.pause();}
