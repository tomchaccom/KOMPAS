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
  /* teacher.js row() 는 .k-chip / .k-chip.look 으로 순간 줄을 가른다 */
  function chip(txt, opts) {
    return el('span', 'k-chip' + (opts && opts.look ? ' look' : ''), txt);
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
  /* 요약 카드 — 제목 · 눈에 띄는 표시(칩) · 오른쪽 자리(나침반 그림 · 방향). 칩이 없으면 한 줄 */
  var summarySeq = 0;
  function summary(opts) {
    var root = el('section', 'k-summary');
    var main = el('div', 'k-summary-main');
    var h = el('h4', null, opts.title);
    h.id = 'k-summary-h-' + (++summarySeq);   /* 다시 그릴 때마다 새 id — 겹치지 않게 */
    root.setAttribute('aria-labelledby', h.id);
    main.appendChild(h);
    if (opts.chips && opts.chips.length) {
      var row = el('div', 'k-summary-chips');
      opts.chips.forEach(function (c) { row.appendChild(chip(c.txt, { look: c.look })); });
      main.appendChild(row);
    } else main.appendChild(el('p', 'k-summary-empty', '표시할 것이 아직 없어요.'));
    root.appendChild(main);
    if (opts.aside) {
      var as = el('div', 'k-summary-aside');
      as.appendChild(opts.aside);
      root.appendChild(as);
    }
    return root;
  }
  function note(label, text) {
    var n = el('div', 'k-note');
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

  CC.kit = { el: el, esc: esc, chip: chip, fold: fold, note: note, code: code, summary: summary };
})(window.CC = window.CC || {});
