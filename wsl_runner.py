"""Experimental WSL-only launcher. No workspace or secret paths enter bwrap."""
import json, os, resource, shutil, subprocess, sys, threading

BWRAP = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else shutil.which('bwrap')
PYTHON = '/usr/bin/python3.12'
LIBS = ['libc.so.6', 'libm.so.6', 'libz.so.1', 'libexpat.so.1', 'libffi.so.8']

def command(worker):
    if not BWRAP or not os.path.isfile(BWRAP) or not os.access(BWRAP, os.X_OK):
        raise RuntimeError('bubblewrap not found; install it or set DELTA_WSL_BWRAP to its absolute Linux path.')
    required = [PYTHON, '/usr/lib/python3.12', '/etc/ld.so.cache', '/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'] + ['/lib/x86_64-linux-gnu/'+x for x in LIBS]
    if not all(os.path.exists(x) for x in required):
        raise RuntimeError('This experimental runner requires Ubuntu x86_64 with Python 3.12 and its runtime libraries.')
    argv = [BWRAP, '--unshare-user','--unshare-pid','--unshare-net','--unshare-ipc','--unshare-uts',
            '--uid','0','--gid','0','--hostname','delta-lab-worker','--die-with-parent','--as-pid-1',
            '--disable-userns','--assert-userns-disabled','--cap-drop','ALL','--clearenv',
            '--size','33554432','--tmpfs','/','--dir','/usr','--dir','/usr/bin',
            '--ro-bind',PYTHON,PYTHON,'--symlink','python3.12','/usr/bin/python3',
            '--dir','/usr/lib','--ro-bind','/usr/lib/python3.12','/usr/lib/python3.12',
            '--dir','/lib','--dir','/lib/x86_64-linux-gnu']
    for lib in LIBS:
        path='/lib/x86_64-linux-gnu/'+lib
        argv += ['--ro-bind',path,path]
    argv += ['--dir','/lib64','--ro-bind','/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2','/lib64/ld-linux-x86-64.so.2',
             '--dir','/etc','--ro-bind','/etc/ld.so.cache','/etc/ld.so.cache','--dev','/dev','--proc','/proc',
             '--size','1048576','--tmpfs','/tmp','--dir','/home','--dir','/mnt',
             '--setenv','HOME','/tmp','--setenv','TMPDIR','/tmp','--setenv','PATH','/usr/bin:/bin',
             '--setenv','PYTHONNOUSERSITE','1','--setenv','PYTHONHASHSEED','0','--setenv','TZ','UTC',
             '--chdir','/tmp','--','/usr/bin/python3','-S','-c',worker]
    return argv

def limits():
    for key, value in [(resource.RLIMIT_CPU,3),(resource.RLIMIT_AS,512*1024*1024),
                       (resource.RLIMIT_FSIZE,1024*1024),(resource.RLIMIT_NOFILE,64),
                       (resource.RLIMIT_CORE,0),(resource.RLIMIT_NPROC,128)]:
        resource.setrlimit(key,(value,value))

def main():
    probing = len(sys.argv)>1 and sys.argv[1]=='--probe'
    if probing:
        worker="import sys;sys.stdout.write('ready')"
        payload=b''
    else:
        raw=sys.stdin.buffer.read(1500001)
        if len(raw)>1500000: raise RuntimeError('Runner request too large')
        request=json.loads(raw)
        worker=request.pop('worker')
        if not isinstance(worker,str) or len(worker)>20000: raise RuntimeError('Invalid worker')
        payload=json.dumps(request,ensure_ascii=True,allow_nan=False).encode()
    proc=subprocess.Popen(command(worker),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,preexec_fn=limits)
    buffers=[bytearray(),bytearray()]
    exceeded=threading.Event()
    def drain(stream,index):
        while True:
            chunk=stream.read(4096)
            if not chunk: break
            if len(buffers[index])+len(chunk)>100000:
                exceeded.set()
                try: proc.kill()
                except ProcessLookupError: pass
                break
            buffers[index].extend(chunk)
    readers=[threading.Thread(target=drain,args=(proc.stdout,0),daemon=True),threading.Thread(target=drain,args=(proc.stderr,1),daemon=True)]
    for thread in readers: thread.start()
    def send():
        try: proc.stdin.write(payload); proc.stdin.close()
        except (OSError,BrokenPipeError): pass
    threading.Thread(target=send,daemon=True).start()
    try: proc.wait(timeout=13)
    except subprocess.TimeoutExpired:
        proc.kill(); proc.wait(); raise RuntimeError('Sandbox timed out')
    for thread in readers: thread.join(timeout=1)
    if exceeded.is_set(): raise RuntimeError('Sandbox output exceeded the limit')
    if proc.returncode:
        sys.stderr.buffer.write(buffers[1][-2000:]); return proc.returncode
    if probing and buffers[0] != b'ready': raise RuntimeError('Unexpected sandbox probe output')
    sys.stdout.buffer.write(buffers[0]); return 0

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as exc:
        sys.stderr.write('WSL sandbox: '+str(exc)[:1000]+'\n'); sys.exit(1)
