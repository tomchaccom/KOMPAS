/* 화면 조각 — 칩 · 접는 줄 · 안내 상자 · 코드 블록. DOM 만 만진다.
 * 화면이 같은 조각을 따로따로 만들다 갈라지지 않게 한 곳에 둔다. 모양은 kit.css. */
(function (CC) {
  'use strict';

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  /* teacher.js row() 가 .mark / .mark.look 으로 순간 줄을 가르므로 mark 를 함께 붙인다 */
  function chip(txt, opts) {
    return el('span', 'k-chip mark' + (opts && opts.look ? ' look' : ''), txt);
  }
  function fold(title, opts) {
    opts = opts || {};
    var root = el('details', 'k-fold');
    if (opts.open) root.open = true;
    root.appendChild(el('summary', null, title));
    var body = el('div', 'k-fold-body');
    root.appendChild(body);
    if (opts.onToggle) root.addEventListener('toggle', function () { opts.onToggle(root.open); });
    return { root: root, body: body };
  }
  /* saybox 는 e2e 가 고르는 이름 — 바꿀 때 테스트와 같이 */
  function note(label, text) {
    var n = el('div', 'k-note saybox');
    n.appendChild(el('span', 'k', label));
    n.appendChild(el('span', null, text));
    return n;
  }
  /* 코드는 줄마다 한 칸 — 줄 번호는 CSS 가 센다. 긴 줄은 접어서 서랍이 옆으로 밀리지 않는다 */
  function code(src) {
    var pre = el('pre', 'k-code');
    String(src || '').replace(/\n+$/, '').split('\n').forEach(function (line) { pre.appendChild(el('span', 'ln', line)); });
    return pre;
  }

  CC.kit = { el: el, esc: esc, chip: chip, fold: fold, note: note, code: code };
})(window.CC = window.CC || {});
