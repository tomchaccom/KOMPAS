/* 강사 화면 단계별 생성 — 1 개념 확인, 2 예시 고르기, 3 만들기(모범 답안을 이 브라우저에서 돌려 정답을 얻는다),
 * 4 고치고 확정. 서버는 코드를 실행하지 않는다 — 정답은 AI 가 셈한 숫자가 아니라 실행한 값이다.
 * 서버 통신은 CC.sb.api 만 쓴다. teacher.html 은 init 한 줄만 부른다.
 *
 *   CC.genflow.init({ room: fn, students: fn, saved: fn })
 */
(function (CC) {
  function $(s) { return document.querySelector(s); }
  var gen = 0;   /* 가장 최근 요청만 화면에 반영한다 — 늦게 온 옛 응답은 버린다 */
  var sgen = 0;  /* 따로 풀기 — 자료를 고치거나 새로 만들거나 확정하면 이전 풀이 결과는 버린다 */
  var bgen = 0;  /* 만들기·다시 돌리기도 같은 방식. 예시 요청과 따로 센다 — 예시를 더 본다고 만들던 초안이 버려지면 안 된다 */
  var st = { concept: null, examples: [], seen: [], pick: -1, py: null, pyFail: false, wait: [], d: null, res: null };
  var CM = CC.codemission;
  var PY_FAIL = 'Python을 불러오지 못했어요. 새로고침한 뒤 다시 만들어 주세요.';
  var RETRIES = 2;
  var SPENT = '생성 횟수를 다 썼어요. 관리자에게 문의해 주세요.';

  function level() {
    return { difficulty: $('#gen-diff').value, stages: CC.onboard.spread(st.opts.students()) };
  }
  function call(body) {
    var l = level(); body.difficulty = l.difficulty; body.stages = l.stages;
    return CC.sb.api('/api/mission-steps', body);
  }
  function say(t) { $('#sg-status').textContent = t || ''; }
  /* 만들기 진행 — 서버 단계(SSE)와 이 브라우저에서 돌려 보는 단계를 한 목록에. 다시 만들기도 같은 목록에 잇는다 */
  var prog = null;
  function progress(first) {
    if (prog) prog.remove();
    prog = CC.genProgress($('#sg-prog'), first, { title: '문제를 만드는 중이에요', stages: CC.genProgress.BUILD });
    return prog;
  }
  function fail(e) { say(e && e.message ? e.message : '잠시 뒤에 다시 해 주세요.'); }

  /* 남은 생성 — 서버가 알려 준 수만 두 생성 버튼 옆에 보인다. 0 이면 두 버튼을 끈다(다시 켜는 건 새로고침 — 한도는 관리자만 늘린다).
     수가 없는 응답(로컬 개발 서버 등)은 그대로 둔다 */
  function quota(n) {
    if (typeof n !== 'number') return;
    st.spent = n <= 0; st.left = n;
    [].forEach.call(document.querySelectorAll('.gen-left'), function (s) { s.textContent = st.spent ? SPENT : '남은 생성 ' + n + '개'; });
    if (st.spent) $('#gen-btn').disabled = true;
    $('#sg-build').disabled = st.spent || st.pick < 0;
  }
  function spent(e) { if (e && e.status === 403 && e.body && e.body.left === 0) quota(0); }

  /* 4단계 — 지금 단계만 펼치고, 끝난 단계는 한 줄 요약 + 고치기. reached 는 상태가 남아 있는 가장 먼 단계 */
  var NAMES = ['수업 내용', '개념 확인', '이야기 고르기', '문제 확인'];
  var cur = 1, reached = 1;
  function sums() {
    var c = CM.concept(st.concept), x = st.examples[st.pick];
    return [$('#gen-lesson').value.trim(), c ? c.label : '', x ? x.title : '', st.d ? val('#sg-title', st.d.title) : ''];
  }
  function paint() {
    var v = sums();
    [].forEach.call(document.querySelectorAll('.gp-s'), function (li, i) {
      var k = i + 1;
      li.hidden = k > reached && k !== cur;
      li.querySelector('.gp-body').hidden = k !== cur;
      li.querySelector('.gp-sum').hidden = k === cur;
      li.querySelector('.gp-v').textContent = v[i];
      li.querySelector('.gp-fix').textContent = k < cur ? '고치기' : '보기';
      if (k === 4) li.querySelector('.gp-t').textContent = st.fresh ? '문제가 만들어졌어요' : '문제 확인';
    });
    $('#gp-count').textContent = cur + ' / 4 ' + NAMES[cur - 1];
    [].forEach.call(document.querySelectorAll('.gp-bar i'), function (b, i) { b.classList.toggle('on', i < cur); });
  }
  function go(n) { if (n === 4) st.fresh = false; cur = n; if (n > reached) reached = n; paint(); }
  /* 앞 단계의 입력이 바뀌면 그 뒤 상태는 버린다(초안 포함) — 옛 초안이 새 개념 옆에 남지 않게 */
  function drop(n) {
    reached = n; sgen++; st.d = null; st.fresh = false;
    $('#sg-draft').textContent = '';
    if (prog) { prog.remove(); prog = null; }
  }
  /* 만드는 동안은 개념을 바꾸지 못한다 — 바꾸면 이미 차감된 초안이 어디에도 못 붙는다 */
  function busy(on) { $('#sg-concept-pick').disabled = on; $('#sg-concept').disabled = on; }
  /* 만든 문제가 있는데 뒤 상태를 버려야 하면 먼저 묻는다 — 조용히 잃지 않는다 */
  function ask(yes, no) {
    var box = $('#gp-confirm');
    box.hidden = false;
    $('#gp-yes').onclick = function () { box.hidden = true; yes(); };
    $('#gp-no').onclick = function () { box.hidden = true; if (no) no(); };
    $('#gp-yes').focus();
  }
  function tab(name, noSave) {
    var q = name === 'quick';
    $('#gt-step').setAttribute('aria-selected', q ? 'false' : 'true');
    $('#gt-quick').setAttribute('aria-selected', q ? 'true' : 'false');
    $('#gt-step').tabIndex = q ? -1 : 0; $('#gt-quick').tabIndex = q ? 0 : -1;
    $('#gp-step').hidden = q; $('#gp-quick').hidden = !q;
    /* 수업 내용·핵심·난이도는 두 방식이 같이 쓴다 — 칸을 복제하지 않고 보이는 쪽으로 옮긴다(값이 그대로 따라온다) */
    var f = $('#gen-fields');
    if (q) $('#gp-quick-slot').appendChild(f); else $('.gp-s[data-step="1"] .gp-act').parentNode.insertBefore(f, $('.gp-s[data-step="1"] .gp-act'));
    if (!noSave && CC.prefs) CC.prefs.set('genTab', name);
  }

  function pick(i) {
    st.pick = i;
    [].forEach.call(document.querySelectorAll('.sg-ex'), function (b, k) {
      b.setAttribute('aria-pressed', k === i ? 'true' : 'false');
    });
    $('#sg-build').disabled = i < 0 || !!st.spent;
    paint();
  }

  function show(list) {
    var box = $('#sg-examples');
    box.textContent = '';
    st.examples = list;
    list.forEach(function (x, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sg-ex'; b.setAttribute('aria-pressed', 'false');
      [x.title, x.situation, '→ ' + x.why].forEach(function (t) {
        var s = document.createElement('span'); s.textContent = t; b.appendChild(s);
      });
      b.addEventListener('click', function () { pick(i); });
      box.appendChild(b);
    });
    pick(-1);
  }

  /* more=true 면 지금 보인 제목을 seen 에 쌓아 겹치지 않게 받는다. 개념을 바꾸면 처음부터 */
  function load(more) {
    var my = ++gen;
    if (more) st.examples.forEach(function (x) { st.seen.push(x.title); }); else { st.seen = []; show([]); }
    say('예시를 가져오는 중이에요.');
    return call({ action: 'examples', concept: st.concept, seen: st.seen.slice() }).then(function (r) {
      if (my !== gen) return;
      show(r.examples || []); say('');
    }).catch(function (e) { if (my === gen) fail(e); });
  }

  function boot() {
    if (st.py || !CC.pyrun) return;
    /* 한 번만 — 3·4단계가 st.py 로 모범 답안을 돌린다. 불러오기에 실패하면 pyrun 대기열은 영영 안 돈다 —
       기다리던 실행을 모두 실패로 끝내 화면이 '돌려 보는 중'에 멈추지 않게 한다 */
    st.py = CC.pyrun.create(function (t, ok) {
      if (ok || !/^Python을 불러오지/.test(t)) return;
      st.pyFail = true;
      st.wait.splice(0).forEach(function (j) { j.no(new Error(PY_FAIL)); });
    });
  }

  function py(code) {
    return new Promise(function (ok, no) {
      if (st.pyFail || !st.py) return no(new Error(PY_FAIL));
      var job = { no: no };
      st.wait.push(job);
      st.py.run(code, function (output, error) {
        var i = st.wait.indexOf(job);
        if (i >= 0) st.wait.splice(i, 1);
        ok({ output: output, error: error });
      });
    });
  }

  /* 자료마다 모범 답안을 돌린다. 앞줄 literal_eval — 자료가 리터럴이 아니면(강사가 식을 넣으면) 에러로 잡는다 */
  function runAll(d) {
    var runs = Promise.all(d.inputs.map(function (x) {
      return py('import ast as _ast\n_ast.literal_eval(' + JSON.stringify(x.v) + ')\n' + CM.dataLine(d, x.v) + '\n' + d.solution);
    }));
    return runs.then(function (rs) {
      return py(CM.usesCode(d.solution)).then(function (u) {
        var list = null;
        try { list = u.error ? null : JSON.parse(String(u.output).trim()); } catch (e) { list = null; }
        return { runs: rs, uses: list };
      });
    });
  }

  function problems(d, r) {
    var out = [];
    if (!CM.concept(d.concept)) out.push('고른 개념을 알 수 없어요.');
    return out.concat(CM.solcheck(d, r.runs, r.uses).map(function (p) { return p.msg; }));
  }

  /* 3단계 — 만들고 돌려 보고, 걸리면 이유를 붙여 다시 만든다(최대 RETRIES 번).
     다시 만들 때는 직전 응답의 ticket 을 싣는다 — 서버가 같은 1개로 센다. 새 "만들기" 는 ticket 없이 */
  /* prev: 직전에 만들어 돌려 본 초안 {d, res, p}. 재요청이 실패해도 이건 이미 한 번 차감되고 받은 것이라 버리지 않는다 */
  function make(probs, left, ticket, prev) {
    var my = ++bgen;
    say('');
    var pg = prev && prog ? prog : progress('서버에 요청을 보내는 중이에요');
    if (prev) pg.step({ code: 'again', msg: '돌려 보다 걸린 점을 붙여 다시 요청하는 중이에요 (' + (RETRIES - left) + '차)' });
    busy(true);
    boot();
    var body = { action: 'build', concept: st.concept, example: st.examples[st.pick],
      wish: $('#sg-wish').value.trim(), problems: probs, lesson: $('#gen-lesson').value.trim() };
    if (ticket) body.ticket = ticket;
    var l = level(); body.difficulty = l.difficulty; body.stages = l.stages;
    return CC.genProgress.call('/api/mission-steps', body, function (s) { if (my === bgen) pg.step(s); }).then(function (r) {
      /* 차감은 이미 일어났다 — 늦은 응답이라도 수는 반영한다. 다만 더 최근에 받은 수보다 큰 값으로 되돌리지는 않는다 */
      if (r && typeof r.left === 'number' && (st.left == null || r.left <= st.left)) quota(r.left);
      if (my !== bgen) return;
      var d = r && r.draft;
      if (!d || !Array.isArray(d.inputs) || !d.inputs.length || typeof d.solution !== 'string') throw new Error('초안을 받지 못했어요. 다시 만들어 주세요.');
      d.inputs.forEach(function (x) { x.v = oneLine(x.v); });
      pg.step({ code: 'run', msg: '모범 답안을 이 브라우저에서 자료마다 돌려 보는 중이에요' });
      return runAll(d).then(function (res) {
        if (my !== bgen) return;
        var p = problems(d, res);
        if (p.length && left > 0) return make(p, left - 1, r.ticket, { d: d, res: res, p: p });
        pg.done();
        draft(d, res, p);
        say('');
      });
    }).catch(function (e) {
      spent(e);
      if (my !== bgen) return;
      pg.fail();   /* 서버가 단계를 보냈으면 어디서 멈췄는지 남긴다 */
      if (!prev) { busy(false); return fail(e); }
      draft(prev.d, prev.res, prev.p);
      say('다시 만들지 못해서 처음 만든 문제를 보여 드려요. 걸린 곳을 고쳐 쓰거나 만들기를 다시 눌러 주세요.');
    });
  }

  /* 자료는 한 줄짜리 리터럴 — 학생 화면의 자료 줄 찾기(DATA_RE)가 한 줄만 본다 */
  function oneLine(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim(); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function field(label, id, value) {
    var l = el('label', 'lb', label), i = el('input', 'in');
    i.id = id; i.value = value || '';
    l.appendChild(i);
    return l;
  }
  function sec(title, sub) {
    var s = el('div', 'sec'), h = el('h3', null, title);
    if (sub) h.appendChild(el('span', 'h-sub', ' — ' + sub));
    s.appendChild(h);
    return s;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* 외우기 함정은 자료 1의 이름·정답으로 다시 쓴다 — 섞인 자리 그대로, 강사 눈앞에서 순서를 바꾸지 않는다 */
  function hardcode() {
    var d = st.d, opts = d.define.options;
    for (var k = 0; k < opts.length; k++) {
      if (opts[k].trap === 'hardcode') { opts[k] = CM.hardcodeOption(d.inputs[0].name, d.expected[0]); $('.sg-hard').textContent = opts[k].v; }
    }
  }

  /* 실행 결과를 화면과 초안에 반영 — 정답, 외우기 함정(자료 1 정답으로), 검사 이유 */
  function apply(res, probs) {
    var d = st.d;
    st.res = res;
    d.expected = res.runs.map(function (r) { return r.error ? '' : String(r.output).trim(); });
    [].forEach.call(document.querySelectorAll('.sg-answer'), function (o, i) {
      o.textContent = res.runs[i].error ? '—' : d.expected[i];
    });
    hardcode();
    var box = $('#sg-problems');
    box.textContent = '';
    box.appendChild(el('b', null, '검수 필요 — 학생에게 내기 전에 확인해 주세요'));
    probs.forEach(function (p) { box.appendChild(el('span', null, '· ' + p)); });
    box.hidden = !probs.length;
    $('#sg-save').disabled = false;
    solve(d);
  }

  /* 모범 답안을 보이지 않고 문제·자료만 주어 따로 풀게 한 뒤, 같은 자료로 돌려 정답과 견준다. 기다리지 않는다.
     실패하면 아무것도 안 띄운다 — 판정이 아니라 사실 한 줄이다 */
  function solve(d) {
    var my = ++sgen, out = $('#sg-solve');
    if (out) out.textContent = '';
    CC.sb.api('/api/mission-steps', { action: 'solve', situation: val('#sg-situation', d.situation), brief: val('#sg-brief', d.brief),
      inputs: d.inputs.map(function (x) { return { name: x.name, v: x.v }; }) }).then(function (r) {
      if (my !== sgen || typeof (r && r.code) !== 'string') return;
      /* 자료마다 차례로, 첫 에러에서 멈춘다 — AI 풀이가 무한 반복이면 한꺼번에 넣은 실행이 대기열에서
         5초씩 줄줄이 기다려 만들기·다시 돌리기를 막는다. 에러(시간 초과 포함)는 많아야 한 번 */
      var rs = [];
      return d.inputs.reduce(function (p, x) {
        return p.then(function (stop) {
          if (stop || my !== sgen) return true;
          return py(CM.dataLine(d, x.v) + '\n' + r.code).then(function (q) { rs.push(q); return !!q.error; });
        });
      }, Promise.resolve(false)).then(function (stop) {
        if (stop || my !== sgen) return;
        /* 따로 푼 풀이가 고른 개념 없이 답을 냈다면 그 문제는 개념 없이도 풀린다(스펙 '하면 안 되는 것').
           판정이 아니라 사실 한 줄 — 강사가 자료나 요청을 고칠지 정한다 */
        return py(CM.usesCode(r.code)).then(function (u) {
          if (my !== sgen) return;
          var list = null;
          try { list = u.error ? null : JSON.parse(String(u.output).trim()); } catch (e) { list = null; }
          var diff = [];
          rs.forEach(function (q, i) {
            var o = String(q.output).trim();
            if (o !== d.expected[i]) diff.push(d.inputs[i].name + ' — ' + d.expected[i] + ' / ' + o);
          });
          var c = CM.concept(d.concept);
          out.textContent = (diff.length ? '따로 푼 답과 달라요: ' + diff.join(' · ') : '따로 푼 답과 같아요') +
            (c && !CM.uses(d.concept, list) ? ' · 따로 푼 풀이에는 고른 개념(' + c.label + ')이 쓰이지 않았어요' : '');
        });
      });
    }).catch(function () {});
  }

  function rerun(i, input) {
    var d = st.d, v = oneLine(input.value);
    input.value = v;
    if (v === d.inputs[i].v) return;
    d.inputs[i].v = v;
    sgen++;                               /* 옛 자료로 따로 푼 결과가 다시 계산하는 사이에 들어오지 않게 */
    $('#sg-solve').textContent = '';
    var my = ++bgen;
    $('#sg-save').disabled = true;
    say('돌려 보는 중이에요.');
    runAll(d).then(function (res) {
      if (my !== bgen) return;
      apply(res, problems(d, res)); say('');
    }).catch(function (e) { if (my === bgen) fail(e); });
  }

  /* 4단계 — 서버·AI·강사의 글은 모두 textContent/value 로만 넣는다 */
  function draft(d, res, probs) {
    st.d = d;
    var c = CM.concept(d.concept);
    d.define = d.define || {};
    d.define.options = shuffle((d.define.options || []).filter(function (o) { return o && o.trap !== 'hardcode'; })
      .concat([{ v: '', trap: 'hardcode' }]));
    var box = $('#sg-draft');
    box.textContent = '';
    busy(false);
    if (cur === 3) go(4); else { st.fresh = true; reached = 4; paint(); }   /* 만드는 사이 앞 단계로 돌아갔으면 끌고 오지 않고 한 줄로 알린다 */
    var root = el('div', 'draft');
    var hd = el('div', 'draft-hd');
    hd.appendChild(el('span', null, '초안 — 고친 뒤 확정하세요'));
    if (c) hd.appendChild(el('span', 'kind', c.label));
    root.appendChild(hd);
    var pb = el('div', 'review-box'); pb.id = 'sg-problems'; pb.setAttribute('role', 'status'); pb.hidden = true;
    root.appendChild(pb);

    var s1 = sec('문제');
    s1.appendChild(field('문제 이름', 'sg-title', d.title));
    s1.appendChild(field('상황', 'sg-situation', d.situation));
    s1.appendChild(field('학생에게 오는 요청', 'sg-brief', d.brief));
    root.appendChild(s1);

    var s2 = sec('자료', '파이썬 값 한 줄. 마지막 자료가 반례예요. 오른쪽은 모범 답안을 돌린 정답이에요');
    d.inputs.forEach(function (x, i) {
      var row = el('div', 'drow sg-drow' + (x.counter ? ' counter' : '')), nm = el('span', 'dname');
      var n = el('input', 'in sg-data-name'); n.value = x.name || ''; n.dataset.idx = i; n.setAttribute('aria-label', '자료 ' + (i + 1) + ' 이름');
      n.addEventListener('change', function () { x.name = n.value.trim() || x.name; n.value = x.name; if (i === 0) hardcode(); });
      nm.appendChild(n);
      if (x.counter) nm.appendChild(el('span', 'h-sub', '반례' + (x.axis === 'count' ? ' · 개수 변화' : x.axis === 'empty' ? ' · 빈 결과' : '')));
      var v = el('input', 'in mono sg-data-val'); v.value = x.v; v.dataset.idx = i; v.setAttribute('aria-label', '자료 ' + (i + 1) + ' 내용');
      v.addEventListener('change', function () { rerun(i, v); });
      var a = el('output', 'sg-answer'); a.setAttribute('aria-label', '자료 ' + (i + 1) + ' 정답');
      row.appendChild(nm); row.appendChild(v); row.appendChild(a);
      s2.appendChild(row);
    });
    var so = el('p', 'h-sub'); so.id = 'sg-solve'; so.setAttribute('role', 'status');
    s2.appendChild(so);
    root.appendChild(s2);

    var s3 = sec('성공 조건 보기', '학생에게는 무엇이 진짜인지 안 보여요');
    d.define.options.forEach(function (o, k) {
      var row = el('div', 'opt');
      if (o.trap === 'hardcode') {
        row.appendChild(el('span', 'sg-hard'));
        row.appendChild(el('span', 'kind', '함정 · 외우기 · 자료 1 정답으로 자동 계산'));
      } else {
        var i = el('input', 'in sg-opt'); i.value = o.v || ''; i.dataset.k = k; i.setAttribute('aria-label', '성공 조건 보기');
        row.appendChild(i);
        row.appendChild(o.trap === 'luck' ? el('span', 'kind', '함정 · 운') : el('span', 'kind real', '진짜'));
      }
      s3.appendChild(row);
    });
    root.appendChild(s3);

    var s4 = sec('설계 카드', '순서는 학생이 정해요. 채점하지 않아요');
    (d.cards || []).forEach(function (cd, k) {
      var row = el('div', 'opt'), i = el('input', 'in sg-card');
      i.value = cd.label || ''; i.dataset.k = k; i.setAttribute('aria-label', '설계 카드');
      row.appendChild(i);
      if (cd.decoy) { i.dataset.decoy = '1'; row.appendChild(el('span', 'kind', '없어도 되는 카드')); }
      s4.appendChild(row);
    });
    root.appendChild(s4);

    var act = el('div', 'draft-actions'), save = el('button', 'pill primary', '확정');
    save.type = 'button'; save.id = 'sg-save';
    save.addEventListener('click', commit);
    act.appendChild(save);
    root.appendChild(act);
    root.appendChild(el('p', 'h-sub', '확정한 뒤에는 자료를 바꿔도 정답이 다시 계산되지 않아요. 자료를 바꾸려면 새로 만들어 주세요.'));
    box.appendChild(root);
    apply(res, probs);
  }

  function val(sel, fallback) { var e = $(sel); return (e && e.value.trim()) || fallback; }

  /* 확정 — solution(모범 답안)과 강사 바람(wish)은 싣지 않는다: missions.data 는 학생이 그대로 읽는다 */
  function commit() {
    var d = st.d, room = st.opts.room();
    if (!room) { say('교실을 먼저 골라 주세요.'); return; }
    if (st.res.runs.some(function (r) { return r.error; })) { say('정답이 없는 자료가 있어요. 자료를 고쳐 주세요.'); return; }
    var title = val('#sg-title', d.title);
    var opts = d.define.options.map(function (o, k) {
      var e = document.querySelector('.sg-opt[data-k="' + k + '"]');
      var v = o.trap === 'hardcode' ? o.v : ((e && e.value.trim()) || o.v);
      return o.trap ? { v: v, trap: o.trap } : { v: v };
    });
    var m = {
      id: 'ai-' + Date.now().toString(36), no: 'AI', type: 'sentence', kind: 'code', concept: d.concept,
      title: title, stage: title, situation: val('#sg-situation', d.situation), brief: val('#sg-brief', d.brief),
      lesson: $('#gen-lesson').value.trim(), keyPoint: $('#gen-key').value.trim(),
      inputs: d.inputs.map(function (x, i) {
        var o = { id: x.id || ('d0' + (i + 1)), name: x.name, v: x.v };
        if (x.counter) { o.counter = true; o.axis = x.axis; }
        return o;
      }),
      cards: (d.cards || []).map(function (cd, k) {
        var o = { label: val('.sg-card[data-k="' + k + '"]', cd.label) };
        if (cd.decoy) o.decoy = true;
        return o;
      }),
      define: { q: d.define.q, options: opts },
      expected: d.expected.slice()
    };
    $('#sg-save').disabled = true;
    sgen++;
    CC.sb.saveMission(room.id, m).then(function () {
      drop(1); go(1);
      say('미션이 등록되었어요.');
      st.opts.saved();
    }).catch(function (e) { $('#sg-save').disabled = false; fail(e); });
  }

  function concept() {
    var lesson = $('#gen-lesson').value.trim(), key = $('#gen-key').value.trim();
    /* 1단계에서는 빠른 생성과 같은 자리(#gen-result)에 말한다. 빠른 생성 초안은 지우지 않는다 */
    var res = $('#gen-result'), NO_LESSON = '수업 내용을 입력해주세요.';
    if (!lesson) { res.textContent = NO_LESSON; return; }
    if (res.textContent === NO_LESSON) res.textContent = '';
    boot();
    say('개념을 확인하는 중이에요.');
    call({ action: 'concept', lesson: lesson, keyPoint: key }).then(function (r) {
      if (r.concept === st.concept) { go(2); say(''); return; }   /* 같은 개념이면 뒤 단계(만든 문제 포함)는 그대로 */
      var apply = function () {
        st.concept = r.concept;
        $('#sg-concept-pick').value = r.concept;
        drop(1); go(2);
        return load(false);
      };
      if (st.d) { say(''); return ask(apply); }
      return apply();
    }).catch(fail);
  }

  CC.genflow = {
    state: st,
    quota: quota,
    tab: tab,
    step: go,
    /* 교실을 바꾸면 단계별 만들기는 처음부터 — 옛 교실에서 만든 초안이 새 교실에 저장되지 않게. 늦게 올 응답도 버린다.
       수업 내용 칸과 남은 횟수는 교실이 아니라 강사의 것이라 그대로 둔다 */
    reset: function () {
      gen++; bgen++; sgen++;
      st.concept = null; st.examples = []; st.seen = []; st.res = null;
      busy(false); drop(1); $('#sg-concept-pick').selectedIndex = 0; $('#gp-confirm').hidden = true;
      show([]); say(''); go(1);
    },
    spent: spent,
    /* 화면을 연 강사에게 한 번 — 차감 없음. 못 받아도 생성은 그대로(서버가 다시 거른다) */
    refresh: function () {
      Promise.resolve().then(function () { return CC.sb.api('/api/mission-steps', { action: 'quota' }); })
        .then(function (r) { quota(r && r.left); }).catch(function () {});
    },
    init: function (opts) {
      st.opts = opts;
      var sel = $('#sg-concept-pick');
      CC.codemission.CONCEPTS.forEach(function (c) {
        var o = document.createElement('option'); o.value = c.id; o.textContent = c.label; sel.appendChild(o);
      });
      $('#sg-concept').addEventListener('click', concept);
      $('#sg-more').addEventListener('click', function () { load(true); });
      $('#sg-build').addEventListener('click', function () { if (st.pick >= 0) make([], RETRIES); });
      sel.addEventListener('change', function () {
        var v = sel.value, go2 = function () { st.concept = v; drop(2); paint(); load(false); };
        if (st.d && v !== st.concept) ask(go2, function () { sel.value = st.concept; });
        else go2();
      });
      $('#sg-draft').addEventListener('input', paint);
      $('#sg-next').addEventListener('click', function () { go(3); });
      [].forEach.call(document.querySelectorAll('.gp-fix'), function (b) {
        b.addEventListener('click', function () { go(+b.closest('.gp-s').dataset.step); });
      });
      var tabs = [$('#gt-step'), $('#gt-quick')];
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { tab(i ? 'quick' : 'step'); });
        t.addEventListener('keydown', function (e) {
          var n = e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? (i + 1) % 2 : e.key === 'Home' ? 0 : e.key === 'End' ? 1 : -1;
          if (n < 0) return;
          e.preventDefault(); tab(n ? 'quick' : 'step'); tabs[n].focus();
        });
      });
      tab(CC.prefs && CC.prefs.get('genTab', 'step') === 'quick' ? 'quick' : 'step', true);
      paint();
    }
  };
})(window.CC = window.CC || {});
