/* 생성 진행 표시 — 서버가 SSE 로 보낸 단계(js/data/supabase.js stream)를 강사 화면에 그린다.
 *
 *   var p = CC.genProgress(부모 요소, 첫 문장, { title, stages });
 *   p.step({ code, msg, t })   p.done()   p.fail()   p.remove()
 *
 * 한눈에 '지금 돌고 있다'가 보여야 한다 (2026-11-20 사람 피드백: 보기 힘들어서 제대로 도는지 모르겠다).
 *   머리줄    돌아가는 표시 · 제목 · 큰 시계 + 움직이는 막대 — 단계가 안 와도(예전 서버 · 막힌 망) 살아 있는 게 보이게
 *   흐름      stages 를 주면 큰 단계(유형 고르기 → 초안 쓰기 → 검수)에서 지금 어디인지
 *   목록      서버가 보낸 문장 그대로. 지금 줄은 노란 바탕 · 굵게, 끝난 줄은 걸린 초
 * 접근성(WCAG 2.1 AA · KWCAG 2.2): 상태는 색 · 점 · 기호가 아니라 글자('지금' · '끝남' · '아직')로 보인다.
 *   글자 대비 4.5:1 이상, 테두리 · 막대 3:1 이상 — 밝은 · 어두운 테마 둘 다 (teacher.css 에 잰 값을 적었다)
 * 만들 때 화면 밖이면 보이는 곳으로 끌어온다 — 노트북 화면에서 버튼 아래가 접혀 안 보였다.
 * 끝나면 '다 만들었어요 · 걸린 시간' 한 줄만 남기고 목록은 접는다. 실패하면 목록을 펼친 채 둔다.
 * 문장은 사실만(무엇을 하는 중인지) — 칭찬 · 예상 남은 시간 · 백분율은 넣지 않는다(맞히지 못하는 숫자다).
 * 학생 화면에는 쓰지 않는다.
 */
(function (CC) {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sec(n) { return Math.max(0, Math.round(n)) + '초'; }
  function quiet() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  CC.genProgress = function (host, first, opts) {
    opts = opts || {};
    var title = opts.title || '만드는 중이에요';
    var stages = opts.stages || null;   /* [{ label, codes: [...] }] */
    var t0 = Date.now();

    var box = el('div', 'gen-prog run');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');

    var head = el('div', 'gen-prog-head');
    var spin = el('span', 'gen-prog-spin');
    spin.setAttribute('aria-hidden', 'true');   /* 꾸밈 — 상태는 옆 제목 글자가 말한다 */
    head.appendChild(spin);
    var htxt = el('span', 'gen-prog-title', title);
    head.appendChild(htxt);
    var clock = el('span', 'gen-prog-clock', '0초');
    /* 1초마다 바뀌는 숫자는 화면 낭독기가 읽지 않게 — 단계가 바뀔 때만 알린다 */
    clock.setAttribute('aria-hidden', 'true');
    head.appendChild(clock);
    box.appendChild(head);
    var bar = el('div', 'gen-prog-bar');
    bar.setAttribute('aria-hidden', 'true');
    bar.appendChild(el('span'));
    box.appendChild(bar);

    var track = null, tracks = [];
    if (stages && stages.length) {
      track = el('ol', 'gen-prog-track');
      stages.forEach(function (g, i) {
        var li = el('li', 'gen-prog-g');
        li.appendChild(el('span', 'gen-prog-n', String(i + 1)));
        li.appendChild(el('span', 'gen-prog-gl', g.label));
        li.appendChild(el('span', 'gen-prog-gs', '아직'));   /* 상태는 색이 아니라 글자로 (WCAG 1.4.1) */
        track.appendChild(li);
        tracks.push(li);
      });
      box.appendChild(track);
    }

    var list = el('ol', 'gen-prog-list');
    box.appendChild(list);
    host.appendChild(box);

    /* 화면 밖이면 끌어온다. 칸은 단계가 올 때마다 자라므로(많게는 9줄) 처음 크기로 '가까운 쪽'에 맞추면
     * 곧 다시 아래로 넘친다 — 위쪽에 붙이되 scroll-margin-top 만큼 띄워 누른 버튼도 보이게 둔다(teacher.css) */
    try {
      var r = box.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.45 || r.top < 0) box.scrollIntoView({ block: 'start', behavior: quiet() ? 'auto' : 'smooth' });
    } catch (e) { /* 그리기 전 · 오래된 브라우저 */ }

    var cur = null;   /* { li, t, code } */
    var heard = 0;    /* 서버가 보낸 단계 수 — 0 이면 실패해도 남길 게 없다 */
    var count = 0;    /* 목록 줄 수 — 끝나면 '단계 n개' */
    var timer = setInterval(tick, 1000);

    function now() { return (Date.now() - t0) / 1000; }
    function tick() {
      clock.textContent = sec(now());
      if (cur) cur.li.querySelector('.gen-prog-t').textContent = sec(now() - cur.t);
    }
    function mark(code) {
      if (!track) return;
      var at = -1;
      stages.forEach(function (g, i) { if (g.codes.indexOf(code) >= 0) at = i; });
      if (at < 0) return;   /* 흐름에 없는 단계(요청 보내기 등)는 흐름을 바꾸지 않는다 */
      tracks.forEach(function (li, i) {
        li.className = 'gen-prog-g' + (i < at ? ' done' : i === at ? ' now' : '');
        li.querySelector('.gen-prog-gs').textContent = i < at ? '끝남' : i === at ? '지금' : '아직';
        if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
    }
    function close(t) {
      if (!cur) return;
      cur.li.className = 'gen-prog-s done';
      cur.li.querySelector('.gen-prog-tag').textContent = '끝남';
      cur.li.querySelector('.gen-prog-t').textContent = sec(t - cur.t);
      cur.li.removeAttribute('aria-current');
      cur = null;
    }
    function step(s) {
      /* 서버의 첫 'start' 는 연결 확인용 — 화면의 '요청을 보내는 중' 과 겹쳐 보이지 않는다 */
      if (!s || !s.msg || s.code === 'start') return;
      if (s.code !== 'local') heard++;
      if (cur && cur.code === s.code && cur.li.querySelector('.gen-prog-m').textContent === s.msg) return;
      var t = now();
      close(t);
      var li = el('li', 'gen-prog-s now');
      li.setAttribute('aria-current', 'step');
      li.appendChild(el('span', 'gen-prog-tag', '지금'));
      li.appendChild(el('span', 'gen-prog-m', s.msg));
      var tt = el('span', 'gen-prog-t', '0초');
      tt.setAttribute('aria-hidden', 'true');
      li.appendChild(tt);
      list.appendChild(li);
      count++;
      cur = { li: li, t: t, code: s.code };
      mark(s.code);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function end(cls, text) {
      close(now()); stop(); tick();
      box.className = 'gen-prog ' + cls;
      htxt.textContent = text;
    }

    if (first) step({ code: 'local', msg: first });

    return {
      step: step,
      /* 결과를 받았을 때 — 시계를 멈추고 한 줄만 남긴다. 단계는 눌러서 펼쳐 볼 수 있게 접어 둔다 */
      done: function () {
        end('ok', '다 만들었어요 · 걸린 시간 ' + sec(now()));
        clock.textContent = '';
        tracks.forEach(function (li) { li.className = 'gen-prog-g done'; li.removeAttribute('aria-current'); li.querySelector('.gen-prog-gs').textContent = '끝남'; });
        var more = el('details', 'gen-prog-more');
        more.appendChild(el('summary', null, '지나온 단계 ' + count + '개 보기'));
        box.removeChild(list);
        more.appendChild(list);
        box.appendChild(more);
      },
      /* 실패했을 때 — 서버 단계를 받았으면 어디서 멈췄는지 펼친 채 남기고(true), 아니면 치운다 */
      fail: function () {
        end('stop', '여기서 멈췄어요 · ' + sec(now()));
        clock.textContent = '';
        /* '지금' 으로 남기면 아직 도는 것처럼 읽힌다 — 멈춘 칸은 글자로 '멈춤' */
        tracks.forEach(function (li) {
          if (li.className.indexOf('now') < 0) return;
          li.className = 'gen-prog-g stopped'; li.removeAttribute('aria-current');
          li.querySelector('.gen-prog-gs').textContent = '멈춤';
        });
        var last = list.lastChild;
        if (last && heard) { last.className = 'gen-prog-s stopped'; last.querySelector('.gen-prog-tag').textContent = '멈춤'; }
        if (heard) return true;
        this.remove();
        return false;
      },
      remove: function () { stop(); if (box.parentNode) box.parentNode.removeChild(box); },
      el: box
    };
  };

  /* 빠른 생성의 큰 흐름 — 서버(api/_generate.py · _review.py)가 보내는 code 와 맞춘다 */
  CC.genProgress.QUICK = [
    { label: '유형 고르기', codes: ['choose'] },
    { label: '초안 쓰기', codes: ['draft', 'fix'] },
    { label: '검수', codes: ['review', 'regen'] }
  ];
  /* 단계별 만들기 — 서버 초안(api/_steps.py) 뒤에 이 브라우저에서 돌려 본다(js/ui/genflow.js) */
  CC.genProgress.BUILD = [
    { label: '초안 쓰기', codes: ['draft', 'fix', 'again'] },
    { label: '돌려 보기', codes: ['run'] }
  ];

  /* 로그인한 강사의 생성 요청 — 단계를 받을 수 있으면 CC.sb.stream, 아니면(가짜 sb · 옛 data 층) CC.sb.api */
  CC.genProgress.call = function (path, body, onStep, signal) {
    return CC.sb.stream ? CC.sb.stream(path, body, onStep, signal) : CC.sb.api(path, body, signal);
  };
})(window.CC = window.CC || {});
