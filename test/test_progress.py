"""생성 진행 단계 SSE(api/_progress.py) 검증 — LLM · Supabase 없이.

  python3 test/test_progress.py
"""
import importlib.util
import json
import os
import sys
import threading
import time
import urllib.request
from http.server import HTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'api'))
import _progress  # noqa: E402
from _progress import listen, step, stream  # noqa: E402

fail = 0


def t(name, cond, extra=''):
    global fail
    print(('  ok  ' if cond else '  FAIL') + ' ' + name)
    if not cond:
        fail += 1
        if extra:
            print('       → ' + str(extra)[:300])


def parse(raw):
    """SSE 바이트 → [(event, data)] — 화면(js/data/supabase.js readSSE)과 같은 규칙."""
    out = []
    for block in raw.decode().split('\n\n'):
        ev, data = 'message', []
        for line in block.split('\n'):
            if line.startswith('event:'):
                ev = line[6:].strip()
            elif line.startswith('data:'):
                data.append(line[5:].lstrip())
        if data:
            out.append((ev, json.loads('\n'.join(data))))
    return out


print('step · listen')
step('x', '듣는 쪽 없음')  # 아무 일 없이 지나가야 한다
got = []
r = listen(lambda c, m: got.append((c, m)), lambda: (step('a', '하나'), step('b', '둘'), 7)[-1])
t('듣는 쪽이 받는다', got == [('a', '하나'), ('b', '둘')], got)
t('listen 은 fn 의 반환값', r == 7)
step('y', '끝난 뒤')
t('listen 이 끝나면 다시 아무도 안 듣는다', len(got) == 2)
t('알림이 터져도 일은 계속', listen(lambda c, m: 1 / 0, lambda: (step('a', 'x'), 'ok')[-1]) == 'ok')

print('stream')
buf = []
t0 = time.monotonic()


def work():
    step('draft', '초안을 쓰는 중이에요')
    time.sleep(0.25)
    step('review', '검수하는 중이에요 (1차)')
    return 200, {'title': '창고 주문서', 'left': 3}


st, body = stream(work, t0, buf.append, ping=0.1)
evs = parse(b''.join(buf))
t('결과를 그대로 돌려준다', (st, body) == (200, {'title': '창고 주문서', 'left': 3}))
t('단계 둘 + 결과 하나', [e for e, _ in evs] == ['step', 'step', 'result'], evs)
t('단계 순서 · 문장', [d['code'] for e, d in evs if e == 'step'] == ['draft', 'review'])
t('t 는 지난 초', all(isinstance(d['t'], float) for e, d in evs if e == 'step'))
t('result 에 status · body', evs[-1][1] == {'status': 200, 'body': body}, evs[-1])
t('조용하면 ping 주석', b': ping\n\n' in b''.join(buf))

buf = []
st, body = stream(lambda: (422, {'error': '문제를 만들지 못했어요.', 'reasons': {'brief': ['x']}}), t0, buf.append)
t('실패 상태도 result 로', parse(b''.join(buf))[-1][1]['status'] == 422)


def boom():
    raise RuntimeError('x')


buf = []
st, _ = stream(boom, t0, buf.append)
t('일이 터지면 502 result', st == 502 and parse(b''.join(buf))[-1][1]['status'] == 502)

done = []


def broken(b):
    raise BrokenPipeError()


def slow():
    step('a', 'x')
    time.sleep(0.1)
    done.append(1)
    return 200, {}


st, _ = stream(slow, t0, broken)
t('연결이 끊겨도 일은 끝까지 간다(한도 기록이 일 안에 있다)', done == [1] and st == 200)

print('핸들러 — Accept 로 갈라 보낸다')


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(ROOT, 'api', name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


for name in ('generate-mission', 'mission-steps'):
    mod = load(name)
    mod.ident = lambda token, env, http: ('teacher-1', None)

    def fake_serve(body, llm, t0, tid=None, env=None, http=None):
        step('draft', '초안을 쓰는 중이에요')
        return 200, {'echo': body, 'tid': tid}

    mod.serve = fake_serve
    srv = HTTPServer(('127.0.0.1', 0), mod.handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_port}/'

    def post(accept=None):
        h = {'Content-Type': 'application/json', 'Authorization': 'Bearer x'}
        if accept:
            h['Accept'] = accept
        req = urllib.request.Request(url, data=json.dumps({'action': 'build'}).encode(), headers=h, method='POST')
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.headers.get('Content-Type'), r.read()

    ct, raw = post()
    t(f'{name}: Accept 없으면 예전처럼 JSON', ct.startswith('application/json') and json.loads(raw)['tid'] == 'teacher-1', ct)
    ct, raw = post('text/event-stream')
    evs = parse(raw)
    t(f'{name}: SSE 면 event-stream', ct.startswith('text/event-stream'), ct)
    t(f'{name}: start → draft → result', [d.get('code') or e for e, d in evs] == ['start', 'draft', 'result'], evs)
    t(f'{name}: result 본문이 JSON 응답과 같다', evs[-1][1]['body'] == {'echo': {'action': 'build'}, 'tid': 'teacher-1'})
    srv.shutdown()

print()
print('ALL PASS' if not fail else f'{fail} FAIL')
sys.exit(1 if fail else 0)
