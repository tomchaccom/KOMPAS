/* Cut & Check — 전송 계층
 *
 * 화면은 서버가 있는지 없는지 모른다. 이 파일만 안다.
 *
 * 어댑터 둘
 *   local  브라우저 안에서 끝낸다. 지금 기본값이고, 서버가 죽어도 이걸로 수업이 된다
 *   http   config.apiBase 로 보낸다. 서버가 붙으면 자동으로 이쪽이 선택된다
 *
 * 화면이 쓰는 것은 아래 셋뿐이다. 어댑터를 바꿔도 이 모양은 안 바뀐다.
 *   send(events)  이벤트를 보낸다 → Promise<{ok}>
 *   board()       교실 전체 상태를 받는다 → Promise<[학생]>
 *   watch(cb)     바뀔 때마다 부른다 → 해제 함수
 *
 * 왜 Promise 로 감싸는가 —
 *   local 은 동기로 끝나지만 http 는 아니다.
 *   지금 동기로 쓰면 서버 붙이는 날 화면 코드를 전부 다시 써야 한다.
 *   느린 쪽에 모양을 맞춰두는 게 나중에 싸다.
 *
 * 무엇을 보내지 않는가 —
 *   이름, 학번, 정답 여부. 서버는 좌석과 행동만 안다.
 *   이름은 교사의 브라우저에만 있고 (좌석표), 네트워크를 타지 않는다.
 */
(function (CC) {
  'use strict';

  /* ── local ──────────────────────────────────────────
   * 저장은 store 가 한다. api 는 store 를 부르기만 한다. */
  var local = {
    name: 'local',
    send: function (evs) {
      return Promise.resolve({ ok: true, n: evs.length });
    },
    board: function () {
      var me = CC.store && CC.store.fold();
      return Promise.resolve(me ? [me] : []);
    },
    watch: function (cb) {
      /* 같은 브라우저의 다른 탭에서 바뀌면 알려준다 —
       * 교사가 한 화면에서 학생 화면을 띄워 시연할 때 이게 필요하다 */
      var h = function (e) { if (!e.key || e.key.indexOf('cutcheck.') === 0) cb(); };
      window.addEventListener('storage', h);
      return function () { window.removeEventListener('storage', h); };
    }
  };

  /* ── http ───────────────────────────────────────────
   * 서버 계약은 docs/server.md. 여기 있는 세 엔드포인트가 전부다. */
  function http(base, code) {
    function url(p) { return base.replace(/\/$/, '') + p; }

    return {
      name: 'http',

      send: function (evs) {
        return fetch(url('/events'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: code, seat: CC.config.seatId, v: CC.config.schema, events: evs })
        }).then(function (r) {
          if (!r.ok) throw new Error('send ' + r.status);
          return r.json();
        });
      },

      board: function () {
        return fetch(url('/board?room=' + encodeURIComponent(code)))
          .then(function (r) {
            if (!r.ok) throw new Error('board ' + r.status);
            return r.json();
          })
          .then(function (d) {
            /* 서버가 접어서 주면 그대로, 원본 이벤트를 주면 여기서 접는다.
             * 접는 규칙은 어느 쪽이든 js/core/fold.js 하나다. */
            if (d.students) return d.students;
            return CC.fold.foldMany(d.events || []);
          });
      },

      watch: function (cb) {
        /* SSE. 안 되는 망이면 조용히 폴링으로 내려간다 —
         * 교실 와이파이에서 SSE 가 막히는 건 드물지 않다. */
        var src = null, timer = null, dead = false;
        try {
          src = new EventSource(url('/stream?room=' + encodeURIComponent(code)));
          src.onmessage = function () { cb(); };
          src.onerror = function () {
            if (dead) return;
            try { src.close(); } catch (e) { /* noop */ }
            src = null;
            timer = setInterval(cb, 4000);
          };
        } catch (e) {
          timer = setInterval(cb, 4000);
        }
        return function () {
          dead = true;
          if (src) { try { src.close(); } catch (e) { /* noop */ } }
          if (timer) clearInterval(timer);
        };
      }
    };
  }

  var adapter = CC.config && CC.config.online()
    ? http(CC.config.apiBase, CC.config.classroomCode)
    : local;

  CC.api = {
    mode: adapter.name,
    send: function (evs) { return adapter.send(evs); },
    board: function () { return adapter.board(); },
    watch: function (cb) { return adapter.watch(cb); },

    /* 테스트와 시연용. 실제 화면은 부르지 않는다 */
    _use: function (a) { adapter = a; CC.api.mode = a.name; },
    _local: local,
    _http: http
  };

  /* AI 튜터. 서버가 없거나 실패하면 reject — 화면은 "쓸 수 없어요"를 보여주고 수업은 계속된다. */
  CC.tutorApi = function (body) {
    return fetch('/api/tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('tutor ' + r.status);
      return r.json();
    });
  };

  /* ── SSE 로 받는 생성 요청 (CC.sse) ─────────────────
   * 생성은 길게는 50초가 걸린다. Accept: text/event-stream 을 붙이면 서버(api/_progress.py)가
   *   event: step    { code, msg, t }   지금 하는 일 — 화면은 onStep 으로 받아 보인다
   *   event: result  { status, body }   마지막에 한 번. 진짜 HTTP 상태는 여기
   * 를 흘린다. 로그인 거절 · 형식 오류 · 예전 서버는 JSON 으로 오니 Content-Type 으로 갈라 읽는다.
   * 결과는 CC.sb.api 와 같은 꼴 — 성공이면 본문, 실패면 status · body(· reasons) 를 단 Error.
   * 토큰은 CC.sb.stream 이 붙여 이걸 부른다. 로컬 모드는 토큰 없이 바로 부른다. */
  function fail(status, j) {
    var err = new Error((j && j.error) || '서버에 연결하지 못했어요.');
    err.status = status; err.body = j || {};
    if (status === 422) err.reasons = j && j.reasons;
    return err;
  }
  /* 빈 줄로 나뉜 덩어리 하나가 사건 하나. ':' 로 시작하는 줄(ping)은 버린다 → 남은 글(다음 덩어리 앞부분) */
  function parseSSE(text, onEvent) {
    var parts = text.replace(/\r\n/g, '\n').split('\n\n');
    var rest = parts.pop();
    parts.forEach(function (block) {
      var ev = 'message', data = [];
      block.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) data.push(line.slice(5).replace(/^ /, ''));
      });
      if (!data.length) return;
      var d;
      try { d = JSON.parse(data.join('\n')); } catch (e) { return; }
      onEvent(ev, d);
    });
    return rest;
  }
  function readSSE(r, onStep) {
    var result = null;
    function on(ev, d) {
      if (ev === 'step') { if (onStep) { try { onStep(d); } catch (e) { /* 화면 오류가 결과를 막지 않게 */ } } }
      else if (ev === 'result') result = d;
    }
    function finish() {
      if (!result) throw fail(502, { error: '응답이 끝까지 오지 않았어요. 다시 시도해 주세요.' });
      if (result.status >= 200 && result.status < 300) return result.body;
      throw fail(result.status, result.body);
    }
    /* 스트림을 못 읽는 브라우저면 다 받은 뒤 한 번에 — 단계는 늦게 보이지만 결과는 같다 */
    if (!r.body || !r.body.getReader || typeof TextDecoder === 'undefined') {
      return r.text().then(function (t) { parseSSE(t + '\n\n', on); return finish(); });
    }
    var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
    function pump() {
      return reader.read().then(function (x) {
        if (x.done) { parseSSE(buf + dec.decode() + '\n\n', on); return finish(); }
        buf = parseSSE(buf + dec.decode(x.value, { stream: true }), on);
        return pump();
      });
    }
    return pump();
  }
  /* headers 는 토큰까지 붙인 것. 서버가 SSE 를 모르면(JSON) CC.sb.api 처럼 읽는다 */
  function postStream(path, headers, body, onStep, signal) {
    var h = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    return fetch(path, { method: 'POST', headers: h, body: JSON.stringify(body), signal: signal }).then(function (r) {
      if ((r.headers.get('Content-Type') || '').indexOf('text/event-stream') === 0) return readSSE(r, onStep);
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw fail(r.status, j);
        return j;
      });
    });
  }
  CC.sse = { post: postStream, parse: parseSSE };
})(window.CC = window.CC || {});
