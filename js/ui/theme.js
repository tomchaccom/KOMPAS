/* 밝은 · 어두운 화면 바꾸기 — 화면마다 #theme-toggle 버튼 하나(강사 · 관리자는 사이드바, 나머지는 위 도구 줄 · 오른쪽 위).
 *
 *   CC.theme.apply()        저장한 고름을 <html data-theme> 에 — <head> 에서 CSS 를 그리기 전에 부른다(깜박임 없게)
 *   CC.theme.bind(button)   누르면 바꾸고 이 브라우저에 기억한다
 *
 * 고른 적이 없으면 기기 설정(prefers-color-scheme)을 따른다. 색은 styles.css · sentence.css 의 토큰이
 * :root[data-theme="dark" | "light"] 로 이미 나뉘어 있어서, 여기는 속성 하나만 바꾼다.
 * 상태는 아이콘이 아니라 글자로 보인다('어두운 화면 · 켜짐') — WCAG 1.4.1. 기억은 CC.prefs(보기 편의)에 둔다 — 같은 브라우저의 모든 화면이 같은 고름으로 열린다.
 * 인쇄용(print) · 발표(slide2 · slides) · 개발용(debug)에는 붙이지 않았다: 종이는 밝아야 하고, 발표는 자체 디자인이다.
 */
(function (CC) {
  'use strict';
  var KEY = 'theme';
  var root = document.documentElement;

  function system() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function saved() {
    var v = CC.prefs ? CC.prefs.get(KEY, null) : null;
    return v === 'dark' || v === 'light' ? v : null;
  }
  function current() { return root.getAttribute('data-theme') || system(); }
  function apply() { var v = saved(); if (v) root.setAttribute('data-theme', v); }

  var MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  var SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';

  function paint(b) {
    var dark = current() === 'dark';
    b.setAttribute('aria-pressed', dark ? 'true' : 'false');
    b.title = dark ? '어두운 화면 켜짐 — 누르면 밝은 화면' : '어두운 화면 꺼짐 — 누르면 어두운 화면';
    var ic = b.querySelector('svg');
    if (ic) ic.innerHTML = dark ? MOON : SUN;
    var st = b.querySelector('.theme-state');
    if (st) st.textContent = dark ? '켜짐' : '꺼짐';
  }

  function bind(b) {
    if (!b) return;
    paint(b);
    b.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      if (CC.prefs) CC.prefs.set(KEY, next);
      paint(b);
    });
    /* 고른 적이 없으면 기기 설정이 바뀔 때 글자도 따라 바꾼다 */
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var on = function () { if (!saved()) paint(b); };
      if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    } catch (e) { /* 오래된 브라우저 */ }
  }

  CC.theme = { apply: apply, bind: bind, current: current };
})(window.CC = window.CC || {});
