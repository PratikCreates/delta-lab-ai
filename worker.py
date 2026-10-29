import json, sys, io, contextlib, hashlib

def main():
    encode_json = json.dumps
    write_result = sys.stdout.write
    request = json.load(sys.stdin)
    namespace = {'__name__': '__delta_user__'}
    sink = io.StringIO()
    try:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            exec(compile(request['code'], '<submitted>', 'exec'), namespace)
            fn = namespace[request['function']]
            if not callable(fn): raise TypeError('Selected name is not callable')
    except BaseException as exc:
        write_result(encode_json({'kind':'load_error','message':type(exc).__name__+': '+str(exc)[:1000]})+'\n')
        return
    def identity(cls):
        module = '<target>' if cls.__module__ == '__delta_user__' else cls.__module__
        return module + '.' + cls.__qualname__
    try:
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            case = request['input']
            value = fn(*case.get('args', []), **case.get('kwargs', {}))
    except BaseException as exc:
        message=str(exc)
        digest=hashlib.sha256()
        for i in range(0,len(message),4096): digest.update(message[i:i+4096].encode('utf-8','surrogatepass'))
        write_result(encode_json({'kind':'exception','type':identity(type(exc)),'bases':[identity(c) for c in type(exc).__mro__[1:]],'message':message[:1000],'message_length':len(message),'message_sha256':digest.hexdigest()},ensure_ascii=True)+'\n')
        return
    try:
        result = encode_json({'kind':'return','value':value},ensure_ascii=True,allow_nan=False,separators=(',',':'))
    except (ValueError,TypeError) as exc:
        result = encode_json({'kind':'serialization_error','message':str(exc)[:1000]})
    write_result(result+'\n')

if __name__ == '__main__': main()
