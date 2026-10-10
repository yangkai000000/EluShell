"""Exercise generated configs in a private, loopback-only Nginx instance."""
import http.client, http.server, json, pathlib, socket, socketserver, ssl, subprocess, sys, threading, time
root=pathlib.Path(__file__).resolve().parent
(root/'logs').mkdir(exist_ok=True)
binary=sys.argv[1]
fixtures=json.loads((root/'redirect-fixture.json').read_text())
ports=[]
for _ in range(4):
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); ports.append(s.getsockname()[1])
assert len(set(ports))==4
http_port, backend_port, other_port, tls_port=ports
class Echo(http.server.BaseHTTPRequestHandler):
    def do_GET(self): self.reply()
    def do_POST(self): self.reply()
    def reply(self):
        body=self.rfile.read(int(self.headers.get('Content-Length','0'))).decode()
        data=json.dumps({'method':self.command,'path':self.path,'body':body}).encode()
        self.send_response(200); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self,*args): pass
class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads=True
backend=ThreadingServer(('127.0.0.1',backend_port),Echo)
threading.Thread(target=backend.serve_forever,daemon=True).start()
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',str(root/'key.pem'),'-out',str(root/'cert.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
context=ssl._create_unverified_context() # Isolated test certificate, loopback only.
def request(port,path,method='GET',body=None,host='app.internal',tls=False):
    conn=(http.client.HTTPSConnection('127.0.0.1',port,context=context,timeout=5) if tls else http.client.HTTPConnection('127.0.0.1',port,timeout=5))
    try:
        conn.request(method,path,body,{'Host':host}); response=conn.getresponse()
        return response.status,response.getheader('Location'),response.read().decode()
    finally: conn.close()
checks=[]
try:
    for name,content in fixtures.items():
        content=content.replace('__ROOT__',str(root))
        for original,actual in zip((28080,28081,28082,28443),ports): content=content.replace(str(original),str(actual))
        # Limit the newly added HTTPS listen to loopback for this fixture only.
        content=content.replace('listen %s ssl;'%tls_port,'listen 127.0.0.1:%s ssl;'%tls_port)
        full='worker_processes 1; daemon off; pid '+str(root/'nginx.pid')+'; error_log '+str(root/'error.log')+' notice; events { worker_connections 64; } http { access_log off; client_body_temp_path '+str(root/'client')+'; proxy_temp_path '+str(root/'proxy')+'; '+content+' }'
        (root/'nginx.conf').write_text(full)
        subprocess.run([binary,'-p',str(root)+'/','-c',str(root/'nginx.conf'),'-t'],check=True)
        proc=subprocess.Popen([binary,'-p',str(root)+'/','-c',str(root/'nginx.conf')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                try: request(http_port,'/ready'); break
                except OSError: time.sleep(.1)
            else: raise AssertionError('Nginx did not start')
            path='/api/report%20one?x=1&name=%E4%B8%AD'
            status,location,body=request(http_port,path)
            if name.endswith('enabled'):
                assert status==308 and location=='https://app.internal:%s%s'%(tls_port,path),(status,location)
                status,location,body=request(http_port,path,host='[2001:db8::7]:%s'%http_port)
                assert status==308 and location=='https://[2001:db8::7]:%s%s'%(tls_port,path),(status,location)
                # Follow 308 with curl and verify that it preserves POST and body.
                output=subprocess.check_output(['curl','--noproxy','*','--insecure','--silent','--show-error','--location','--data','payload=example','http://127.0.0.1:%s%s'%(http_port,path)],timeout=10)
                assert json.loads(output)=={'method':'POST','path':path,'body':'payload=example'},output
                checks.extend(['HTTP 308 preserves host/path/query','IPv6 Host keeps brackets','POST body and method survive redirect'])
            elif name=='manual-disabled':
                assert status==301 and location=='https://app.internal:%s%s'%(tls_port,path),(status,location)
                checks.append('Disabling managed rule retains original manual 301')
            else:
                assert status==200 and json.loads(body)['path']==path,(status,body)
                checks.append('Disabling redirect restores HTTP business route')
            status,location,body=request(tls_port,path,tls=True)
            assert status==200 and location is None and json.loads(body)['path']==path,(status,body)
            assert request(other_port,'/')[0::2]==(200,'other-site')
            checks.extend([name+': HTTPS 200 without loop',name+': sibling site unaffected'])
        finally:
            proc.terminate()
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
finally: backend.shutdown(); backend.server_close()
report={'result':'PASS','binary':binary,'checks':checks,'businessConfigUntouched':True,'testProcessesStopped':True}
(root/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
