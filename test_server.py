import importlib.util, json
from pathlib import Path
from unittest.mock import patch
import pytest

spec = importlib.util.spec_from_file_location('delta_server', Path(__file__).with_name('server.py'))
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
SCHEMA = {'type':'object','properties':{'args':{'type':'array','prefixItems':[{'type':'integer'}],'minItems':1,'maxItems':1},'kwargs':{'type':'object','maxProperties':0}},'required':['args'],'additionalProperties':False}
REQUEST = {'old_code':'def f(x): return x', 'new_code':'def f(x): return x+1','function_name':'f','input_schema':SCHEMA,'candidates':[{'args':[7]}],'model':False,'max_cases':1}

def test_unavailable_sandbox_fails_closed():
    with patch.object(s,'docker_ready',return_value=False), patch.object(s,'run_code') as run:
        with pytest.raises(s.InfrastructureError): s.analyze(REQUEST)
        run.assert_not_called()

def test_invalid_candidate_rejected_before_execution():
    request={**REQUEST,'candidates':[{'args':['not integer']}]}
    with patch.object(s,'run_code') as run:
        with pytest.raises(ValueError): s.analyze(request)
        run.assert_not_called()

def test_differences_and_shrinking_are_based_on_execution_results():
    def run(code, function, case, timeout=15):
        x=case['args'][0]
        return {'kind':'return','value':x+(1 if 'x+1' in code else 0)}
    with patch.object(s,'docker_ready',return_value=True), patch.object(s,'run_code',side_effect=run):
        result=s.analyze(REQUEST)
    row=result['cases'][0]
    assert row['different'] and row['input']=={'args':[0]}
    assert row['original_input']=={'args':[7]} and row['runs'][0]['phase']=='initial'
    assert row['runs'][-1]['phase']=='shrink' and 'DELTA_TARGET_MODULE' in result['export']

def test_infra_error_is_never_reported_as_a_difference():
    with patch.object(s,'docker_ready',return_value=True), patch.object(s,'run_code',side_effect=s.InfrastructureError('timeout')):
        with pytest.raises(s.InfrastructureError,match='timeout'): s.analyze(REQUEST)

def test_export_is_valid_python():
    generated=s.export_test('f',[{'input':{'args':[1]},'old':{'kind':'return','value':1},'different':True}])
    compile(generated,'generated_test.py','exec')

@pytest.mark.skipif(not s.docker_ready(),reason='Docker image or engine unavailable')
def test_real_sandbox_distinguishes_outputs():
    assert s.run_code('def f(x): return x + 1','f',{'args':[4]}) == {'kind':'return','value':5}
    assert s.run_code('def f(x): raise ValueError("bad")','f',{'args':[4]}) == {'kind':'exception','type':'builtins.ValueError','bases':['builtins.Exception','builtins.BaseException','builtins.object'],'message':'bad','message_length':3,'message_sha256':'2f05d4b689d270cafb02285f35f44866f7dc8a2d368a3f9d1124373eeab31fb1'}

def test_upstream_example_includes_control_character_in_scheme():
    import threading, urllib.request
    httpd=s.ThreadingHTTPServer(('127.0.0.1',0),s.Handler)
    thread=threading.Thread(target=httpd.serve_forever,daemon=True); thread.start()
    try:
        with urllib.request.urlopen('http://127.0.0.1:%s/api/example' % httpd.server_port) as response:
            example=json.load(response)
        candidate=example['candidates'][0]
        assert candidate['args'][0] == "http\t://www.python\n.org\t/java\nscript:\talert('msg\r\n')/?query\n=\tsomething#frag\nment"
        validator=s.Draft202012Validator(example['input_schema'])
        assert s.valid_case(candidate,validator)
        assert s.valid_case({'args':['//example.org','ht\ntp'],'kwargs':{}},validator)
    finally:
        httpd.shutdown(); httpd.server_close(); thread.join()

def test_worker_serialization_reference_resists_simple_monkeypatch():
    import subprocess, sys
    request={'code':'import json\njson.dumps = lambda *a, **k: "forged"\ndef f(): return 123', 'function':'f', 'input':{'args':[]}}
    completed=subprocess.run([sys.executable,'-I','-S',str(Path(__file__).with_name('worker.py'))],input=json.dumps(request),text=True,capture_output=True,timeout=5,check=True)
    assert json.loads(completed.stdout)=={'kind':'return','value':123}


def test_worker_serialization_resists_simple_print_monkeypatch():
    import subprocess, sys
    request={'code':'import builtins, sys\nbuiltins.print = lambda *a, **k: sys.__stdout__.write("forged\\n")\ndef f(): return "real"', 'function':'f', 'input':{'args':[]}}
    completed=subprocess.run([sys.executable,'-I','-S',str(Path(__file__).with_name('worker.py'))],input=json.dumps(request),text=True,capture_output=True,timeout=5,check=True)
    assert json.loads(completed.stdout)=={'kind':'return','value':'real'}

def test_oversized_input_is_rejected_before_execution():
    request={**REQUEST,'input_schema':{'type':'object'},'candidates':[{'args':list(range(5000))}]}
    with patch.object(s,'run_code') as run:
        with pytest.raises(ValueError): s.analyze(request)
        run.assert_not_called()

def test_simplifier_yields_lazily():
    import itertools
    values=list(itertools.islice(s.simpler(list(range(100000))),3))
    assert len(values)==3 and values[0]==[]

def test_regex_schema_is_rejected_without_matching():
    schema={'type':'object','properties':{'args':{'type':'array','items':{'type':'string','pattern':'(a+)+$'}}}}
    request={**REQUEST,'input_schema':schema,'candidates':[{'args':['a'*9999+'!']}]}
    with patch.object(s,'run_code') as run:
        with pytest.raises(ValueError,match='regular expressions'): s.analyze(request)
        run.assert_not_called()

def test_incomplete_shrink_returns_completed_observation():
    results=[{'kind':'return','value':7},{'kind':'return','value':8},s.InfrastructureError('deadline')]
    with patch.object(s,'docker_ready',return_value=True), patch.object(s,'run_code',side_effect=results):
        result=s.analyze(REQUEST)
    assert result['summary']['incomplete'] and 'deadline' in result['summary']['incomplete_reason']
    assert result['summary']['comparisons']==1 and result['cases'][0]['different']
    assert len(result['cases'][0]['runs'])==1

def test_unsupported_schema_keyword_rejected():
    request={**REQUEST,'input_schema':{'type':'object','format':'uri'}}
    with pytest.raises(ValueError,match='Unsupported schema'): s.analyze(request)


def test_worker_exception_identity_includes_qualified_class_and_bases():
    import subprocess, sys
    source="class ValidationError(ValueError): pass\ndef f(): raise ValidationError('bad')"
    request={'code':source,'function':'f','input':{'args':[]}}
    completed=subprocess.run([sys.executable,'-I','-S',str(Path(__file__).with_name('worker.py'))],input=json.dumps(request),text=True,capture_output=True,timeout=5,check=True)
    result=json.loads(completed.stdout)
    assert result['type']=='<target>.ValidationError' and result['bases'][0]=='builtins.ValueError'
    assert 'identity(type(exc))' in s.export_test('f',[{'input':{'args':[]},'old':result,'different':True}])


def test_exception_digest_distinguishes_message_suffix():
    import subprocess, sys
    def run(suffix):
        request={'code':"def f(): raise ValueError('a' * 1000 + "+repr(suffix)+")",'function':'f','input':{'args':[]}}
        result=subprocess.run([sys.executable,'-I','-S',str(Path(__file__).with_name('worker.py'))],input=json.dumps(request),text=True,capture_output=True,timeout=5,check=True)
        return json.loads(result.stdout)
    a,b=run('x'),run('y')
    assert a['message']==b['message'] and a['message_sha256']!=b['message_sha256']
