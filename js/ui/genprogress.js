/* 생성 진행 표시 — 서버가 SSE 로 보낸 단계(js/data/supabase.js stream)를 강사 화면에 그린다.
 *
 *   var p = CC.genProgress(부모 요소);   p.step({ code, msg, t })   p.done()   p.remove()
 *
 * 끝난 단계는 걸린 초와 함께 흐리게, 지금 단계는 1초마다 지난 시간을 센다.
 * 단계가 하나도 오지 않아도(예전 서버 · 스트림이 막힌 망) 지난 시간은 센다 — 멈춘 화면처럼 보이지 않게.
 * 문장은 서버가 쓴 사실 그대로다(무엇을 하는 중인지). 학생 화면에는 쓰지 않는다.
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

  CC.genProgress = function (host, first) {
    var t0 = Date.now();
    var box = el('div', 'gen-prog');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    var list = el('ol', 'gen-prog-list');
    var foot = el('p', 'gen-prog-foot');
    var clock = el('span', 'gen-prog-clock', '0초');
    /* 1초마다 바뀌는 숫자는 화면 낭독기가 읽지 않게 — 단계가 바뀔 때만 알린다 */
    foot.setAttribute('aria-hidden', 'true');
    var label = document.createTextNode('지난 시간 ');
    foot.appendChild(label);
    foot.appendChild(clock);
    box.appendChild(list);
    box.appendChild(foot);
    host.appendChild(box);

    var cur = null;   /* { li, t, code } */
    var heard = 0;    /* 서버가 보낸 단계 수 — 0 이면 실패해도 남길 게 없다 */
    var timer = setInterval(tick, 1000);

    function now() { return (Date.now() - t0) / 1000; }
    function tick() {
      clock.textContent = sec(now());
      if (cur) cur.li.querySelector('.gen-prog-t').textContent = sec(now() - cur.t);
    }
    function close(t) {
      if (!cur) return;
      cur.li.className = 'gen-prog-s done';
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
      li.appendChild(el('span', 'gen-prog-dot'));
      li.appendChild(el('span', 'gen-prog-m', s.msg));
      var tt = el('span', 'gen-prog-t', '0초');
      tt.setAttribute('aria-hidden', 'true');
      li.appendChild(tt);
      list.appendChild(li);
      cur = { li: li, t: t, code: s.code };
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    if (first) step({ code: 'local', msg: first });

    return {
      step: step,
      /* 결과를 받았을 때 — 마지막 단계를 닫고 시계를 멈춘다. 표시는 남겨 걸린 시간을 볼 수 있게 */
      done: function () { close(now()); stop(); tick(); label.nodeValue = '걸린 시간 '; box.classList.add('end'); },
      /* 실패했을 때 — 서버 단계를 받았으면 어디서 멈췄는지 남기고(true), 아니면 치운다 */
      fail: function () { this.done(); if (heard) return true; this.remove(); return false; },
      remove: function () { stop(); if (box.parentNode) box.parentNode.removeChild(box); },
      el: box
    };
  };

  /* 로그인한 강사의 생성 요청 — 단계를 받을 수 있으면 CC.sb.stream, 아니면(가짜 sb · 옛 data 층) CC.sb.api */
  CC.genProgress.call = function (path, body, onStep, signal) {
    return CC.sb.stream ? CC.sb.stream(path, body, onStep, signal) : CC.sb.api(path, body, signal);
  };
})(window.CC = window.CC || {});
