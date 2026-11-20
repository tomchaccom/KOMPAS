"""POST /api/mission-steps  { action, ... }  + Authorization: Bearer <Supabase 토큰>

  concept   { lesson, keyPoint }                              → { concept, label, by }
  examples  { concept, seen, difficulty, stages }             → { examples: [{title, situation, why}] }
  build     { concept, example, wish, problems, difficulty, stages, ticket? } → { draft, ticket, left }
  solve     { situation, brief, inputs }                      → { code }
  quota     {}                                                → { left, disabled }

Accept: text/event-stream 이면 진행 단계(step) 뒤에 result { status, body } 를 SSE 로 보낸다 (_progress.py).

build 만 생성 한도를 쓴다(_quota.charge). 한도가 없으면 403 { error, left: 0 } — LLM 은 부르지 않는다.

Vercel Python 핸들러. 일은 _steps.py 가 하고, 여기는 HTTP·강사 확인만 다룬다.
서버는 LLM 만 부르고 AI 가 쓴 코드를 실행하지 않는다 — 실행은 강사 브라우저의 Pyodide 가 한다.
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _quota  # noqa: E402
from _progress import sse_reply, wants_sse  # noqa: E402
import _steps  # noqa: E402
from _auth import NO_LINK, TIMEOUT, bearer, ident, urllib_http  # noqa: E402
from _generate import GenerateError, level_of  # noqa: E402

BAD = (400, {'error': '요청 형식이 잘못됐어요.'})


def _s(v, n):
    return str(v).strip()[:n] if isinstance(v, (str, int, float)) else ''


def _run(body, llm, t0):
    kw = {'call_llm': llm} if llm else {}
    a = body.get('action')
    if a == 'concept':
        lesson, key = _s(body.get('lesson'), 300), _s(body.get('keyPoint'), 300)
        if not lesson:
            return 400, {'error': '수업 내용을 입력해주세요.'}
        return 200, _steps.concept(lesson, key, **kw)
    if a == 'examples':
        seen = body.get('seen') if isinstance(body.get('seen'), list) else []
        return 200, _steps.examples(body.get('concept'), level_of(body), seen, **kw)
    if a == 'build':
        if not isinstance(body.get('example'), dict):
            return BAD
        problems = body.get('problems') if isinstance(body.get('problems'), list) else []
        return 200, _steps.build(body.get('concept'), body['example'], _s(body.get('wish'), 200),
                                 level_of(body), problems, t0=t0, **kw)
    if a == 'solve':
        inputs = body.get('inputs') if isinstance(body.get('inputs'), list) else []
        return 200, _steps.solve(_s(body.get('situation'), 200), _s(body.get('brief'), 200), inputs, **kw)
    return BAD


def handle(body, token, env, http=urllib_http, llm=None):
    """→ (status, json). llm 은 시험용 — 없으면 단계마다 정한 모델."""
    # 55초 예산은 강사 확인(Supabase 2번 × 최대 3초)부터 센다 — build 안에서 재면 최악 61초 > maxDuration 60
    t0 = time.monotonic()
    tid, denied = ident(token, env, http)
    return denied or serve(body, llm, t0, tid, env, http)


def serve(body, llm, t0, tid=None, env=None, http=urllib_http):
    """강사 확인을 마친 뒤의 일 — do_POST 는 본문을 읽기 전에 ident 를 먼저 부르고 이걸 부른다."""
    if not isinstance(body, dict):
        return BAD
    a = body.get('action')
    if a == 'quota':
        info = _quota._try('left', _quota.left, tid, env, http)
        return (200, info) if info else (502, {'error': NO_LINK})
    if a == 'build':
        if not isinstance(body.get('example'), dict):
            return BAD  # 형식이 틀리면 예약도 하지 않는다
        lesson = _s(body.get('lesson'), 200) or _s(body['example'].get('title'), 200)
        # 성공 뒤 기록(최대 TIMEOUT초)까지 55초 안에 — build 에는 그만큼 일찍 시작한 것처럼 t0 를 준다
        return _quota.charge(tid, body.get('ticket'), 'step', lesson, _s(body.get('concept'), 40),
                             lambda: _safe(body, llm, t0 - TIMEOUT), env, http)
    return _safe(body, llm, t0)


def _safe(body, llm, t0):
    try:
        return _run(body, llm, t0)
    except GenerateError as e:
        # 사유는 로그에 남긴다 — 어떤 규칙이 얼마나 자주 걸리는지가 프롬프트 개선의 근거다
        print('[mission-steps] 실패', body.get('action'), json.dumps(e.reasons, ensure_ascii=False), file=sys.stderr)
        return 422, {'error': str(e), 'reasons': e.reasons}
    except Exception as e:  # LLM 서버 오류·키 없음·시간 초과
        print('[mission-steps] 오류', body.get('action'), repr(e), file=sys.stderr)
        return 502, {'error': '문제 생성 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.'}


class handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(200, {})

    def do_POST(self):
        # 강사 확인이 먼저 — 로그인 안 한 요청의 본문은 읽지도 파싱하지도 않는다
        t0 = time.monotonic()
        tid, denied = ident(bearer(self.headers.get('Authorization')), os.environ, urllib_http)
        if denied:
            return self._send(*denied)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        except (ValueError, TypeError, UnicodeDecodeError):
            return self._send(*BAD)
        work = lambda: serve(body, None, t0, tid, os.environ, urllib_http)  # noqa: E731
        if wants_sse(self.headers):
            # Accept: text/event-stream 이면 진행 단계를 흘리고 마지막에 결과를 보낸다 (_progress.py).
            # 로그인 거절 · 본문 형식 오류는 위에서 JSON 으로 끝난다 — 화면은 Content-Type 으로 갈라 읽는다
            return sse_reply(self, work, t0)
        self._send(*work())
