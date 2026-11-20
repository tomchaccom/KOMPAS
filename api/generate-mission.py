"""POST /api/generate-mission  { lesson, keyPoint }  → 미션 JSON (+ guard) + left

Accept: text/event-stream 이면 같은 결과를 SSE 로 — 진행 단계(step) 뒤에 result { status, body } (_progress.py).

Vercel Python 핸들러. 일은 _generate.py 가 하고, 여기는 HTTP · 강사 확인 · 생성 한도만 다룬다.
한 번 부름 = 1 (재요청은 서버 안에서 끝난다). 한도가 없으면 403 { error, left: 0 } — LLM 은 부르지 않는다.
(파일 이름의 하이픈은 주소를 예전 Node 함수와 같게 두려는 것 — 그래서 import 는 못 한다)
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _quota  # noqa: E402
from _progress import sse_reply, wants_sse  # noqa: E402
from _auth import TIMEOUT, bearer, ident, urllib_http  # noqa: E402
from _generate import GenerateError, level_of  # noqa: E402
from _review import make_mission  # noqa: E402

BAD = (400, {'error': '요청 형식이 잘못됐어요.'})


def handle(body, token, env, http=urllib_http, llm=None):
    """→ (status, json). llm 은 시험용 — 없으면 기본 모델."""
    t0 = time.monotonic()
    tid, denied = ident(token, env, http)
    return denied or serve(body, llm, t0, tid, env, http)


def serve(body, llm, t0, tid, env, http=urllib_http):
    if not isinstance(body, dict):
        return BAD
    lesson = str(body.get('lesson') or '').strip()
    key_point = str(body.get('keyPoint') or '').strip()
    if not lesson:
        return 400, {'error': '수업 내용을 입력해주세요.'}
    if not key_point:
        return 400, {'error': '핵심을 입력해주세요.'}
    # 55초 예산을 강사 확인 · 예약부터 세고, 성공 뒤 기록(최대 TIMEOUT초) 몫을 미리 뺀다
    return _quota.charge(tid, None, 'quick', lesson, key_point[:200],
                         lambda: _make(lesson, key_point, body, llm, t0 - TIMEOUT), env, http)


def _make(lesson, key_point, body, llm, t0):
    try:
        kw = {'call_llm': llm} if llm else {}
        return 200, make_mission(lesson, key_point, level=level_of(body), t0=t0, **kw)
    except GenerateError as e:
        # 사유는 로그에 남긴다 — 어떤 규칙이 얼마나 자주 걸리는지가 프롬프트 개선의 근거다 (docs/llm.md)
        print('[generate-mission] 실패', json.dumps(e.reasons, ensure_ascii=False), file=sys.stderr)
        return 422, {'error': str(e), 'reasons': e.reasons}
    except Exception as e:  # LLM 서버 오류·키 없음 등
        print('[generate-mission] 오류', repr(e), file=sys.stderr)
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
        # 로그인한 강사만 — LLM 비용 남용을 막는 장치다 (보안 경계는 아니다: 가입하면 누구나 강사)
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
