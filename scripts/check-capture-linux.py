"""Check the generated capture supervisor on Linux with a synthetic tcpdump process."""
import json, os, pathlib, signal, subprocess, tempfile, time

commands = json.loads(pathlib.Path('capture-linux-command.json').read_text())
with tempfile.TemporaryDirectory(prefix='capture-check-', dir='.') as folder:
    root = pathlib.Path(folder).resolve()
    fake = root / 'tcpdump'
    fake.write_text("#!/usr/bin/python3\nimport os,signal,time\nopen(os.environ['CAPTURE_PID'],'w').write(str(os.getpid()))\nsignal.signal(signal.SIGINT,lambda *_:exit(0))\nsignal.signal(signal.SIGTERM,lambda *_:exit(0))\nprint('READY',flush=True)\nwhile True: time.sleep(.05)\n")
    fake.chmod(0o700)
    env = dict(os.environ, PATH=str(root)+os.pathsep+os.environ['PATH'], CAPTURE_PID=str(root/'pid'))
    checks=[]
    for mode,command in [('timeout',commands[0]),('stop',commands[1]),('disconnect',commands[1])]:
        started=time.monotonic()
        p=subprocess.Popen(command,shell=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
        assert p.stdout.readline()==b'READY\n'
        pid=int((root/'pid').read_text())
        if mode=='stop':p.stdin.write(b'\n');p.stdin.flush()
        if mode=='disconnect':p.stdin.close()
        p.wait(timeout=10)
        time.sleep(.1)
        try:os.kill(pid,0)
        except ProcessLookupError:pass
        else:raise AssertionError('capture child survived '+mode)
        assert time.monotonic()-started<9
        checks.append({'mode':mode,'childReaped':True,'exit':p.returncode})
    print(json.dumps({'result':'PASS','syntheticTcpdump':True,'checks':checks}))
