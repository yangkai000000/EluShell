import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
await build({entryPoints:['electron/nginx-config.ts'],outfile:'test-results/redirect-config.cjs',bundle:true,platform:'node',format:'cjs'});
const {configureTLS}=createRequire(import.meta.url)('../test-results/redirect-config.cjs');
const before=`server {
    listen 127.0.0.1:28080;
    server_name app.internal;
    location / { proxy_pass http://127.0.0.1:28081; }
}
server { listen 127.0.0.1:28082; server_name other.internal; location / { return 200 'other-site'; } }
`;
const enabled=configureTLS(before,0,'__ROOT__/cert.pem','__ROOT__/key.pem',28443,true);
const repeated=configureTLS(enabled,0,'__ROOT__/cert.pem','__ROOT__/key.pem',28443,true);
if(enabled!==repeated) throw Error('Redirect must be idempotent');
const disabled=configureTLS(enabled,0,'__ROOT__/cert.pem','__ROOT__/key.pem',28443,false);
const fixtures={enabled,disabled};
const split=`server { listen 127.0.0.1:28080; server_name app.internal; location / { proxy_pass http://127.0.0.1:28081; } }
server { listen 127.0.0.1:28443 ssl; server_name app.internal; location / { proxy_pass http://127.0.0.1:28081; } }
server { listen 127.0.0.1:28082; server_name other.internal; location / { return 200 'other-site'; } }`;
for(const [name,source] of [['split',split],['manual',split.replace('location / { proxy_pass http://127.0.0.1:28081; }','return 301 https://$host:28443$request_uri;')]]) {
  const on=configureTLS(source,1,'__ROOT__/cert.pem','__ROOT__/key.pem',28443,true,0);
  if(configureTLS(on,1,'__ROOT__/cert.pem','__ROOT__/key.pem',28443,true,0)!==on)throw Error('Split redirect must be idempotent');
  fixtures[name+'-enabled']=on;
  fixtures[name+'-disabled']=configureTLS(on,1,'__ROOT__/cert.pem','__ROOT__/key.pem',28443,false,0);
}
await writeFile('test-results/redirect-fixture.json',JSON.stringify(fixtures));
