"""생성 진행 단계 알림 — 화면이 '지금 무엇을 하는 중인지' 보이게.

일하는 함수(_generate · _review · _steps)는 step(code, msg) 만 부른다. 듣는 쪽이 없으면 아무 일도 없다
(시험 · JSON 응답). SSE 응답은 listen(cb) 안에서 일을 돌려 단계를 받아 보낸다.

단계 문장은 강사 화면에 그대로 뜬다 — 사실만 쓴다(무엇을 하는 중인지). 학생 화면에는 가지 않는다.

SSE 쓰기(sse_reply)도 여기 둔다 — 두 핸들러(generate-mission · mission-steps)가 같은 꼴로 보낸다.
  event: step    data: {"code", "msg", "t"}     t = 요청부터 지난 초
  event: result  data: {"status", "body"}       일의 결과. HTTP 상태는 스트림이라 늘 200, 진짜 상태는 여기
  : ping                                        15초마다 — 프록시가 조용한 연결을 끊지 않게
"""
import contextvars
import json
import queue
import sys
import threading
import time

_cb = contextvars.ContextVar('kompas_progress', default=None)

PING = 15  # 초


def step(code, msg):
    cb = _cb.get()
    if cb is None:
        return
    try:
        cb(code, msg)
    except Exception as e:  # noqa: BLE001 — 알림이 일을 깨면 안 된다
        print('[progress] 알림 실패', repr(e), file=sys.stderr)


def listen(cb, fn):
    """cb 를 듣는 쪽으로 두고 fn() 을 돌린다 → fn 의 반환값."""
    tok = _cb.set(cb)
    try:
        return fn()
    finally:
        _cb.reset(tok)


def wants_sse(headers):
    return 'text/event-stream' in (headers.get('Accept') or '')


def frame(event, data):
    return f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'.encode()


def stream(work, t0, write, ping=PING):
    """work() → (status, json) 를 다른 스레드에서 돌리며 단계를 write(bytes) 로 흘린다.
    시험에서는 write 에 리스트 append 를 넣는다. 끊긴 연결(BrokenPipe)이면 쓰기만 멈추고 일은 끝까지 간다
    — 생성 한도 기록 · 환불이 일 안에 있어서, 중간에 버리면 수가 어긋난다."""
    q = queue.Queue()
    box = {}

    def run():
        try:
            box['r'] = listen(lambda c, m: q.put(('step', {'code': c, 'msg': m, 't': round(time.monotonic() - t0, 1)})), work)
        except Exception as e:  # noqa: BLE001 — work 는 (status, json) 으로 끝나야 하지만 혹시 모를 것
            print('[progress] 일 실패', repr(e), file=sys.stderr)
            box['r'] = (502, {'error': '문제 생성 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.'})
        q.put(None)

    th = threading.Thread(target=run, daemon=True)
    th.start()
    alive = True

    def send(b):
        nonlocal alive
        if not alive:
            return
        try:
            write(b)
        except (BrokenPipeError, ConnectionResetError, OSError):
            alive = False

    while True:
        try:
            item = q.get(timeout=ping)
        except queue.Empty:
            send(b': ping\n\n')
            continue
        if item is None:
            break
        send(frame(*item))
    th.join()
    status, body = box['r']
    send(frame('result', {'status': status, 'body': body}))
    return status, body


def sse_reply(h, work, t0):
    """BaseHTTPRequestHandler h 로 SSE 응답을 보낸다."""
    h.send_response(200)
    h.send_header('Content-Type', 'text/event-stream; charset=utf-8')
    h.send_header('Cache-Control', 'no-cache, no-transform')
    h.send_header('X-Accel-Buffering', 'no')
    h.send_header('Access-Control-Allow-Origin', '*')
    h.end_headers()

    def write(b):
        h.wfile.write(b)
        h.wfile.flush()

    write(frame('step', {'code': 'start', 'msg': '요청을 받았어요', 't': round(time.monotonic() - t0, 1)}))
    return stream(work, t0, write)
