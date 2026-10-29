/* Cut & Check — 교사 화면 조립
 *
 * 이 화면이 지키는 것:
 *   - 점수·정답률·순위를 한 개도 그리지 않는다.
 *   - 모든 줄은 "지금 무엇을 하라"로 읽혀야 한다. 상태 보고가 아니라 개입 목록이다.
 *   - 칭찬 문구를 대신 써주지 않는다. 타이밍만 알려주고 말은 교사가 한다.
 */
(function (CC) {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var el = CC.kit.el, esc = CC.kit.esc;
  /* Supabase 연결 시 실제 학생 데이터 사용. 미연결 시 목업 폴백. */
  var C = CC.classroom;
  var me = null;
  if (CC.sb && CC.sb.active()) {
    /* 목업 학생 제거 — 실제 데이터만 사용 */
    C.students = [];
  } else {
    me = CC.store ? CC.store.fold('나') : null;
    if (me) C.students = [me].concat(C.students);
  }
  var J = function (w, pair) { return CC.particle(w, pair); };
  var fresh = {};   /* 화면을 연 뒤 새 순간이 생긴 학생 id — 폴더에 점. 서랍을 열면 지운다 */

  /* 미션 04 슬롯 id → 사람이 읽는 이름. 교사 화면에 내부 id 가 새어나가면 안 된다. */
  var SLOT_LABEL = {
    text: '들어오는 자료', sep: '자를 기준', targets: '찾을 목록',
    loop: '하나씩 꺼내기', check: '조건 확인', collect: '걸린 것만 모으기'
  };

  function mmss(sec) {
    var m = Math.floor(sec / 60);
    return m < 1 ? '방금' : m + '분째';
  }

  /* ── 요약 타일 ───────────────────────────────────── */
  function tiles() {
    var t = $('#tiles');
    t.innerHTML = '';  /* 중복 렌더 방지 */
    var quiet = C.quiet(), ready = C.ready(), risky = C.risky();
    /* 문장형 학생: 실행+판정한 학생도 "도달"로 카운트 */
    var done = C.students.filter(function (s) {
      return s.stage >= 3 || (s.sRuns && s.sRuns.length > 0);
    }).length;

    [
      { k: '지금 답해줄 수 있음', v: ready.length, u: '명', m: '증상 진술이 완성된 호출', cls: '' },
      { k: '조용히 막힘', v: quiet.length, u: '명', m: '손 안 들고 4분 이상 정지', cls: 'alarm' },
      { k: '성공을 결과로 정의', v: risky.length, u: '명', m: '하드코딩 위험군', cls: 'alarm' },
      { k: '3장 검증까지 도달', v: done, u: '/ ' + C.students.length + '명', m: '한 장만 맞힌 건 제외', cls: 'good' }
    ].forEach(function (d) {
      var box = el('div', 'tile ' + d.cls);
      box.appendChild(el('div', 'k', d.k));
      var v = el('div', 'v', String(d.v));
      v.appendChild(el('small', null, d.u));
      box.appendChild(v);
      box.appendChild(el('div', 'm', d.m));
      t.appendChild(box);
    });
  }

  /* ── 명단 줄 ─────────────────────────────────────── */
  function rowList(sel, pillSel, list, tone, sayFn) {
    var box = $(sel);
    box.innerHTML = '';
    if (pillSel) $(pillSel).textContent = list.length + '명';
    if (!list.length) {
      box.appendChild(el('div', 'emptyrow', '지금은 없어요.'));
      return;
    }
    list.forEach(function (s) {
      var r = el('button', 'trow ' + tone);
      r.type = 'button';
      r.appendChild(el('span', 'av', s.live ? '●' : s.name.charAt(0)));
      var who = el('span', 'who', s.name);
      if (s.live) who.className = 'who live';
      r.appendChild(who);
      var say = el('span', 'say');
      say.innerHTML = sayFn(s);
      r.appendChild(say);
      r.appendChild(el('span', 'meta', mmss(s.idleSec)));
      r.addEventListener('click', function () { openDetail(s); });
      box.appendChild(r);
    });
  }

  /* ── 위험군 ──────────────────────────────────────── */
  function risk() {
    var box = $('#risk');
    box.innerHTML = '';  /* 중복 렌더 방지 */
    var groups = [
      { key: 'hardcode', lab: '이번 결과를 성공으로 정의함', tip: '입력이 바뀌면 무너집니다' },
      { key: 'luck', lab: '오류만 없으면 성공으로 정의함', tip: '무엇이 나와야 하는지 정하지 않았습니다' },
      { key: null, lab: '입력이 바뀌어도 되는 조건으로 정의함', tip: '' },
      { key: 'own', lab: '직접 쓴 문장', tip: '분류하지 않습니다. 읽어보고 판단해주세요 — 자동 분류하는 순간 학생이 쓴 말을 우리가 채점하는 게 됩니다.' }
    ];
    groups.forEach(function (g) {
      var members = C.students.filter(function (s) { return s.define.trap === g.key; });
      if (!members.length) return;
      var d = el('div', 'risk ' + (g.key || ''));
      d.appendChild(el('span', 'lab', g.lab + ' · ' + members.length + '명'));
      d.appendChild(el('p', 'quote', '“' + members[0].define.text + '”'));
      var who = el('p', 'who');
      members.forEach(function (m) { who.appendChild(el('span', null, m.name)); });
      d.appendChild(who);
      if (g.tip) d.appendChild(el('p', 'who', g.tip));
      box.appendChild(d);
    });
  }

  /* ── 흐름 ────────────────────────────────────────── */
  function funnel() {
    var box = $('#funnel');
    box.innerHTML = '';  /* 중복 렌더 방지 */
    var f = C.funnel();
    var total = C.students.length;
    var worstDrop = 0, worstAt = 1;
    f.forEach(function (row, i) {
      if (i > 0) {
        var drop = f[i - 1].n - row.n;
        if (drop > worstDrop) { worstDrop = drop; worstAt = i; }
      }
    });
    f.forEach(function (row, i) {
      var r = el('div', 'frow' + (i === worstAt ? ' drop' : ''));
      r.appendChild(el('span', 'nm', row.title));
      var bar = el('span', 'bar');
      var fill = el('i');
      fill.style.width = Math.round(row.n / total * 100) + '%';
      bar.appendChild(fill);
      r.appendChild(bar);
      r.appendChild(el('span', 'n', String(row.n)));
      box.appendChild(r);
    });
    $('#dropnote').innerHTML = '가장 많이 갈라진 지점은 <b>' + esc(f[worstAt].title) +
      '</b> 입니다. 여기서 ' + worstDrop + '명이 멈췄어요. ' +
      '개별 개입보다 전체에게 한 번 물어보는 게 빠른 구간입니다.';
  }

  /* ── 학생 한 명 (서랍) ───────────────────────────────
   * 이 학생이 한 것을 순서대로 줄로. 판정·점수는 없다. 노란 표시는 "말 걸기 좋은 순간"
   * — 무엇을 말할지는 쓰지 않는다. 데이터는 fold 결과 그대로, 시각만 원래 기록에서 읽는다. */
  var hm = function (t) {
    return t ? new Date(t).toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  };

  /* 이 학생의 원래 기록 — 로컬은 이 브라우저, 서버 모드는 teacher.html 이 C.events 에 넣는다. 목업은 없다 */
  function eventsOf(s) {
    if (s === me) return CC.store ? CC.store.all() : [];
    return (C.events || []).filter(function (e) { return e.sid === s.id; });
  }
  function lastT(evs, types) {
    for (var i = evs.length - 1; i >= 0; i--) if (types.indexOf(evs[i].type) !== -1) return evs[i].t;
    return null;
  }
  /* 미션 id → 미션. 내부 id 는 화면에 내지 않는다 */
  function missionOf(mid) {
    var all = (CC.SENTENCE_MISSIONS || []).concat(CC._roomMissions || []);
    try { all = all.concat(JSON.parse(localStorage.getItem('cutcheck.generated') || '[]')); } catch (e) { /* 저장소가 막혀도 이름만 빠진다 */ }
    return all.filter(function (m) { return m && m.id === mid; })[0] || null;
  }
  function mids(evs) {
    var out = [];
    evs.forEach(function (e) { if (e.mid && out.indexOf(e.mid) === -1) out.push(e.mid); });
    return out;
  }
  function missionName(mid, i) {
    var m = missionOf(mid);
    return m && m.title ? m.title : '미션 ' + (i + 1);
  }

  /* 폴더 아래 한 줄 — 지금 미션 · 단계 */
  function whereNow(s) {
    var evs = eventsOf(s), ms = mids(evs);
    var step = s.sWrap ? '정리까지 했어요'
      : s.sCodes.length ? '코딩'
      : (s.sDesignCount || s.sMethod) ? '설계'
      : s.sDefine ? '성공 조건'
      : C.STAGES[s.stage];
    var last = ms.length ? missionName(ms[ms.length - 1], ms.length - 1)
      : (s.mission && MISSION_NAME[s.mission]) || '';
    return last ? last + ' · ' + step : step;
  }

  /* 한 줄 = 시각 · 무엇 · 내용. 시각을 맨 앞에 둬서 위에서 아래로 훑으면 순서가 읽힌다 */
  function row(dl, label, t, fill, step) {
    var r = el('div', 'row');
    r.dataset.step = step || 0;
    r.dataset.t = t || 0;   /* 단계별 묶음 — 0 은 블록 미션 · 예전 기록 */
    r.appendChild(el('span', 'tm', hm(t)));
    r.appendChild(el('dt', null, label));
    var dd = el('dd');
    fill(dd);
    r.appendChild(dd);
    if (dd.querySelector('.k-chip')) r.classList.add('moment');   /* 고친 순간 — 줄 왼쪽에 노란 선 */
    if (dd.querySelector('.k-chip.look')) r.classList.add('look');   /* 살펴볼 것 — 선 대신 테두리 색 */
    dl.appendChild(r);
  }
  function mark(dd, txt, look) { dd.appendChild(CC.kit.chip(txt, { look: look })); }
  function was(dd, txt) { if (txt) dd.appendChild(el('span', 'was', txt)); }

  /* ── 수업에서 짚을 거리 — 누를 때만 서버에 간다. 학생 질문 원문(quote)은 글자로만 붙인다.
   * 반 전체는 같은 지점에 막힌 학생이 많은 순 — 먼저 짚을 것을 고르는 순서지 학생 순위가 아니다 */
  function recapOn(btn, out, req, many) {
    if (!(CC.sb && CC.sb.active())) { btn.hidden = true; return; }   /* 서버가 없으면 뽑을 수 없다 — 안내 대신 숨긴다 */
    btn.addEventListener('click', function () {
      var r = req();
      out.innerHTML = '';
      if (!r.body.students.length) { out.appendChild(el('p', 'emptyrow', '튜터와 대화하고 끝낸 미션이 아직 없어요.')); return; }
      btn.disabled = true;
      var go = CC.sb && CC.sb.recap ? CC.sb.recap(r.body, r.key) : Promise.reject(new Error('no server'));
      go.then(function (j) { recapList(out, (j && j.items) || [], r, many); },
        function () { out.appendChild(el('p', 'recap-fail', '지금은 뽑지 못했어요. 잠시 뒤 다시 눌러 주세요.')); })
        .then(function () { btn.disabled = false; });
    });
  }
  function recapList(out, items, r, many) {
    if (r.truncated) out.appendChild(el('p', 'was', '최근에 끝낸 40명만 봤어요.'));
    if (!items.length) { out.appendChild(el('p', 'emptyrow', '튜터 대화에서 짚을 거리가 나오지 않았어요.')); return; }
    var whoOf = function (it) { return (it.who || []).map(function (w) { return r.names[w]; }).filter(Boolean); };
    if (many) items = items.slice().sort(function (a, b) { return whoOf(b).length - whoOf(a).length; });
    items.forEach(function (it) {
      var d = el('details', 'recap-item');
      var sm = el('summary');
      sm.appendChild(el('span', 'pt', it.point || ''));
      if (many) sm.appendChild(el('span', 'n', whoOf(it).length + '명'));
      if (it.refused) sm.appendChild(el('span', 'tag', '튜터가 답하지 못함'));
      d.appendChild(sm);
      if (many) {
        var m = missionOf(it.mid);
        d.appendChild(el('p', 'who', whoOf(it).join(', ') + (m && m.title ? ' · ' + m.title : '')));
      }
      d.appendChild(el('p', 'quote', '“' + (it.quote || '') + '”'));
      out.appendChild(d);
    });
  }


  /* ── 나침반 2차 — 서버 모드에서만. 학생 한 명에 카드 하나: 누적 바늘 + 최근 5개 미션의 12칸 체크리스트.
   * 체크·점수는 선생님만 본다. 학생에게는 바늘 하나와 선생님이 쓴 한마디만 간다.
   * 점수로 정렬·평균·순위를 만들지 않는다 — 명단에는 "한마디 기다림" 꼬리표 하나뿐.
   * 바늘이 서로 지워지면(cancel) 기계가 고르지 않는다 — 겹친 후보만 버튼으로 두고 선생님이 고른다 */
  var cRoom = null, cRows = null, cTried = {}, cDraw = {}, cSyncing = false, cListFail = false, cListFailAt = 0, cSeq = 0;
  var cMore = {};   /* 학생별 12칸 표를 펼쳤는지 */
  var cCum = {}, cCumFail = {}, cPick = {}, cInit = false, cDraft = {}, cSending = {}, cFail = {};   /* cDraft — 쓰던 한마디(학생·미션별), 다시 그려도 지키고 보내면 지운다 */
  var COMPASS_FAIL = '지금은 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.';
  var CHECKS = [
    ['N', 'N1', '함정이 아닌 성공 조건을 골랐어요'], ['N', 'N2', '성공 조건을 코드로 직접 옮겼어요'], ['N', 'N3', '튜터에게 이해한 것을 설명하고 물었어요'],
    ['E', 'E1', '설계 카드를 냈어요'], ['E', 'E2', '설계 이유를 자기 말로 적었어요'], ['E', 'E3', '실행해 본 뒤 설계를 고쳤어요'],
    ['S', 'S1', '에러 없이 실행되는 코드가 있어요'], ['S', 'S2', '에러가 난 뒤 스스로 고쳐 다시 돌렸어요'], ['S', 'S3', '반례 자료까지 같은 코드로 돌렸어요'],
    ['W', 'W1', '반례 자료를 직접 돌렸어요'], ['W', 'W2', '판정 근거를 실제 실행 결과에 기댔어요'], ['W', 'W3', '반례가 깨진 걸 보고 고쳤어요']
  ];
  var serverOn = function () { return !!(CC.sb && CC.sb.active()); };
  var ckey = function (sid, mid) { return sid + ':' + mid; };

  /* 이 학생이 끝낸 미션의 DB id — 이벤트 본문에는 DB id 가 없어 _missionDbId 를 쓴다 */
  function finishedOf(s) {
    var out = [];
    eventsOf(s).forEach(function (e) {
      if (e.type === 's-code-judge' && e._missionDbId && out.indexOf(e._missionDbId) === -1) out.push(e._missionDbId);
    });
    return out;
  }
  function waiting(s) {
    return !!cRows && finishedOf(s).some(function (m) { var r = cRows[ckey(s.id, m)]; return !(r && r.sent_at); });
  }
  /* 미션 DB id → 이 학생 기록 안의 미션 id (서랍의 미션 알약·이름이 쓰는 id) */
  function clientMid(s, dbId) {
    var e = eventsOf(s).filter(function (x) { return x._missionDbId === dbId && x.mid; })[0];
    return e ? e.mid : null;
  }
  /* 알림 재료 — 누적 바늘이 지워졌으면 가장 최근 미션과 겹친 후보 */
  function cancelOf(s) {
    var c = cCum[s.id];
    return c && c.cumulative && c.cumulative.cancel && c.rows && c.rows[0] ? { dbId: c.rows[0].missionId, cands: c.cumulative.candidates || [] } : null;
  }

  /* 누적 바늘을 서버에서 받는다. silent — 화면을 처음 열 때 이미 있던 일이라 알리지 않는다 */
  function refreshCum(st, silent, quiet) {
    var roomId = cRoom;
    return CC.sb.compass('cumulative', { classroomId: roomId, studentId: st.id }).then(function (j) {
      if (cRoom !== roomId) return;
      cCum[st.id] = j;
      delete cCumFail[st.id];
      if (cPick[st.id] && (!j.cumulative || (j.cumulative.candidates || []).indexOf(cPick[st.id]) < 0)) delete cPick[st.id];   /* 후보가 바뀌었으면 옛 선택은 서버가 400 으로 거절한다 */
      if (silent && lastSnap && lastSnap[st.id]) catchUp(st);   /* 토스트 없이 — 확인 안 한 것만 목록에 */
    }, function () { if (!cCum[st.id]) cCumFail[st.id] = true; }).then(function () {
      if (cRoom !== roomId) return;
      if (cDraw[st.id]) cDraw[st.id]();
      if (!quiet) renderFolders();
    });
  }

  /* 학생 화면을 열 때 이미 끝났는데 행이 없는 것 — 알림 없이 하나씩 차례로 읽어 둔다 */
  CC._compassSync = function (roomId) {
    if (!serverOn() || !roomId || !CC.sb.compass) return;
    if (cRoom !== roomId) { cRoom = roomId; cRows = null; cTried = {}; cDraw = {}; cListFail = false; cCum = {}; cCumFail = {}; cPick = {}; cInit = false; cDraft = {}; cSending = {}; cFail = {}; }
    if (cListFail && Date.now() - cListFailAt > 60000) cListFail = false;   /* 한 번 끊겼다고 수업 내내 멈추지 않게 — 1분 뒤 다시 */
    var fin = C.students.filter(function (st) { return finishedOf(st).length; });
    if (!fin.length && !cRows) { cInit = true; return; }   /* 끝낸 미션이 없으면 서버에 물을 것도 없고, 이후 일은 모두 새 일이다 */
    if (cListFail || cSyncing) return;
    cSyncing = true;
    var done = function () { cSyncing = false; };
    var loaded = cRows ? Promise.resolve() : CC.sb.compass('list', { classroomId: roomId }).then(function (j) {
      if (cRoom !== roomId) return;
      cRows = {};
      cListFail = false;
      ((j && j.rows) || []).forEach(function (r) { cRows[ckey(r.studentId, r.missionId)] = r; });
    });
    loaded.catch(function () { cListFail = true; cListFailAt = Date.now(); Object.keys(cDraw).forEach(function (k) { cDraw[k](); }); }).then(function () {
      if (!cRows || cRoom !== roomId) return;
      renderFolders();
      Object.keys(cDraw).forEach(function (k) { cDraw[k](); });   /* 열려 있는 카드가 "읽고 있어요" 에 머물지 않게 */
      var todo = [], chain = Promise.resolve();
      fin.forEach(function (st) {
        finishedOf(st).forEach(function (m) {
          var r = cRows[ckey(st.id, m)];
          if ((!r || !r.checks) && !cTried[ckey(st.id, m)]) todo.push([st, m]);   /* 1차 행(checks 없음)도 다시 읽는다 */
        });
        if (!cInit) chain = chain.then(function () { return cRoom === roomId ? refreshCum(st, true, true) : null; });
      });
      var next = function () {
        var it = todo.shift();
        if (!it || cRoom !== roomId) return;
        return analyze(it[0], it[1], false).then(next);
      };
      return chain.then(function () { renderFolders(); }).then(next).then(function () { if (cRoom === roomId) cInit = true; });
    }).then(done, done);
  };

  /* 한 학생·미션을 읽는다 — 실패해도 던지지 않는다 (표시는 카드가 한다) */
  function analyze(st, dbId, force) {
    var k = ckey(st.id, dbId), roomId = cRoom;
    cTried[k] = 'run';
    if (cDraw[st.id]) cDraw[st.id]();
    return CC.sb.compass('analyze', { classroomId: roomId, studentId: st.id, missionId: dbId, force: !!force }).then(function (row) {
      if (cRoom !== roomId) return;
      delete cTried[k];
      cRows[k] = row;
      return refreshCum(st, !cInit);
    }, function () { cTried[k] = 'fail'; }).then(function () {
      if (cDraw[st.id]) cDraw[st.id]();
      renderFolders();
    });
  }

  /* 두드러지는 것 — 표에 있는 예·아니오를 사실 문장 몇 줄로. 점수·순위·반 평균은 쓰지 않는다.
   * 바늘이 지워졌을 땐(cancel) 예가 많은 쪽을 말하지 않는다 — 고르는 건 선생님이다 (CLAUDE.md 예외 둘) */
  function compassGist(rows, cu) {
    var D = CC.compass.DIRS, SH = CC.compass.SHAPE, DS = ['N', 'E', 'S', 'W'];
    var ok = function (r, c) { return !!((r.checks || {})[c[1]] || {}).ok; };
    var ul = el('ul', 'compass-gist');
    ul.setAttribute('aria-label', '두드러지는 것');
    var line = function (k, body) {
      var li = el('li');
      li.appendChild(el('span', 'gk', k));
      var b = el('span', 'gv');
      if (typeof body === 'string') b.textContent = body; else b.appendChild(body);
      li.appendChild(b);
      ul.appendChild(li);
    };
    var yes = { N: 0, E: 0, S: 0, W: 0 };
    CHECKS.forEach(function (c) { rows.forEach(function (r) { if (ok(r, c)) yes[c[0]]++; }); });
    if (!cu.cancel) {
      var hi = Math.max.apply(null, DS.map(function (d) { return yes[d]; })), lo = Math.min.apply(null, DS.map(function (d) { return yes[d]; }));
      var names = function (n) { return DS.filter(function (d) { return yes[d] === n; }).map(function (d) { return SH[d] + ' ' + D[d]; }).join(', '); };
      if (hi === lo) line('네 방향', '예가 같은 만큼 나왔어요');
      else { line('예가 가장 많은 쪽', names(hi)); line('예가 가장 적은 쪽', names(lo)); }
    }
    var many = rows.length > 1;
    var items = function (list) {
      var u = el('ul', 'gist-items');
      list.forEach(function (c) {
        var li = el('li', null, c[2]);
        var q = rows.map(function (r) { return ((r.checks || {})[c[1]] || {}).quote; }).filter(Boolean)[0];   /* 가장 최근 근거 */
        if (q) li.appendChild(el('span', 'q', '“' + q + '”'));
        u.appendChild(li);
      });
      return u;
    };
    var allYes = CHECKS.filter(function (c) { return rows.every(function (r) { return ok(r, c); }); });
    var allNo = many ? CHECKS.filter(function (c) { return rows.every(function (r) { return !ok(r, c); }); }) : [];
    if (allYes.length) line(many ? '미션 ' + rows.length + '개 모두 예' : '예로 나온 항목', items(allYes));
    if (allNo.length) line('미션 ' + rows.length + '개 모두 아니오', items(allNo));
    return ul;
  }

  /* 학생 한 명의 나침반 카드 — 바깥 틀은 하나(.compass-card, 알림이 여기로 내려온다). 안은 셋:
   요약(눈에 띄는 것 · 그림 · 방향) → 할 일(후보 고르기 · 미션별 한마디) → 접힌 자세히(12칸 표 · 튜터 분포).
   mid — 알림으로 고른 미션(없으면 끝낸 미션 전부의 한마디 칸) */
  function compassCard(st, mid, nameOf, marks) {
    var card = el('section', 'compass-card');
    card.setAttribute('aria-label', '나침반');
    var n = ++cSeq;
    var D = CC.compass.DIRS, SH = CC.compass.SHAPE;
    var draw = function () {
      card.innerHTML = '';
      var aside = el('div', 'compass-top');   /* 요약 카드 오른쪽 — 그림 · 방향 · 읽는 중 안내 */
      var todo = el('div', 'compass-todo');
      card.appendChild(CC.kit.summary({ title: '눈에 띄는 것', chips: marks, aside: aside }));
      card.appendChild(todo);
      var cum = cCum[st.id], cu = cum && cum.cumulative, rows = (cum && cum.rows) || [];
      var failed = cCumFail[st.id] || (cListFail && !cRows);
      if (!cu) {
        if (failed) {
          aside.appendChild(el('p', 'recap-fail', COMPASS_FAIL));
          var again = el('button', 'pill compass-reread', '다시 읽기');
          again.type = 'button';
          again.addEventListener('click', function () {
            if (cListFail && !cRows) { cListFail = false; draw(); CC._compassSync(cRoom); } else { delete cCumFail[st.id]; draw(); refreshCum(st, false); }
          });
          aside.appendChild(again);
        } else aside.appendChild(el('p', 'emptyrow', '읽고 있어요.'));
      } else if (!cu.n) {
        aside.appendChild(el('p', 'emptyrow', '아직 읽은 미션이 없어요.'));
      } else {
        if (cu.cancel) {
          /* 지워졌다 — 바늘을 그리지 않는다. 겹친 후보만, 선생님이 고른다 */
          var pick = el('div', 'compass-pick');
          pick.appendChild(el('p', 'compass-cancel', '바늘이 서로 지워져요. 어느 쪽이 더 보였는지 골라 주세요.'));
          var bs = el('div', 'compass-cands');
          bs.setAttribute('role', 'group');
          bs.setAttribute('aria-label', '더 보인 방향');
          (cu.candidates || []).forEach(function (d) {
            var b = el('button', 'pill compass-cand', SH[d] + ' ' + D[d]);
            b.type = 'button';
            b.dataset.dir = d;
            b.setAttribute('aria-pressed', cPick[st.id] === d ? 'true' : 'false');
            b.addEventListener('click', function () { if (cPick[st.id] === d) delete cPick[st.id]; else cPick[st.id] = d; draw(); });
            bs.appendChild(b);
          });
          pick.appendChild(bs);
          if (rows[0]) pick.appendChild(el('p', 'compass-msg', '고른 방향은 가장 최근 미션(' + nameOf(rows[0].missionId, clientMid(st, rows[0].missionId)) + ')의 한마디와 함께 보내져요. 학생 화면은 지난번 보낸 방향 그대로예요.'));
          todo.appendChild(pick);   /* 고르는 일은 할 일 칸에 */
        } else {
          var fig = el('div', 'compass-fig');
          fig.innerHTML = CC.compass.svg(cu.needle_deg, cu.length);   /* core 가 숫자만으로 만든 마크업 */
          aside.appendChild(fig);
          var say = el('div', 'compass-now');
          say.appendChild(el('strong', 'compass-dir', SH[cu.dir] + ' ' + D[cu.dir]));
          say.appendChild(el('p', 'compass-line', CC.compass.line(cu.dir) + (CC.compass.even(cu.length) ? ' · 고르게 가고 있어요' : '')));
          aside.appendChild(say);
        }
        aside.appendChild(compassGist(rows, cu));   /* 바늘 바로 옆 — 표를 펴지 않아도 보이게 */

        /* 12칸 — 줄 = 항목, 열 = 최근 미션(왼쪽이 가장 최근). 예 ✓ / 아니오 –, 근거 인용은 글자 그대로 */
        var more = el('details', 'compass-more');
        more.open = !!cMore[st.id];   /* 다시 그려도 펼친 채로 */
        more.addEventListener('toggle', function () { cMore[st.id] = more.open; });
        more.appendChild(el('summary', null, '항목 12개 표 — 미션별 예 · 아니오와 근거'));
        var wrap = el('div', 'compass-tablewrap');
        var tb = el('table', 'compass-table');
        tb.appendChild(el('caption', 'sr-only', '최근 미션 ' + rows.length + '개의 체크 항목'));
        var hr = el('tr'); hr.appendChild(el('th', null, ''));
        rows.forEach(function (r) {
          var th = el('th', null, nameOf(r.missionId, clientMid(st, r.missionId))); th.scope = 'col'; hr.appendChild(th);
        });
        var thd = el('thead'); thd.appendChild(hr); tb.appendChild(thd);
        var tbody = el('tbody'), last = '';
        CHECKS.forEach(function (c) {
          if (c[0] !== last) {
            last = c[0];
            var gr = el('tr', 'dir-head'), gh = el('th', null, SH[c[0]] + ' ' + D[c[0]]);
            gh.colSpan = rows.length + 1; gr.appendChild(gh); tbody.appendChild(gr);
          }
          var tr = el('tr'); var lh = el('th', null, c[2]); lh.scope = 'row'; tr.appendChild(lh);
          rows.forEach(function (r) {
            var ck = (r.checks || {})[c[1]] || {}, td = el('td', ck.ok ? 'yes' : 'no');
            td.appendChild(el('span', 'mk', ck.ok ? '✓' : '–'));
            td.appendChild(el('span', 'sr-only', ck.ok ? '했어요' : '안 했어요'));
            if (ck.ok && ck.quote) td.appendChild(el('span', 'q', '“' + ck.quote + '”'));
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        tb.appendChild(tbody); wrap.appendChild(tb); more.appendChild(wrap); card.appendChild(more);

        /* 튜터에게 물은 것을 네 방향으로 나눈 분포 — 참고 자료일 뿐 점수에 더하지 않는다 */
        var tot = { N: 0, E: 0, S: 0, W: 0 };
        rows.forEach(function (r) { ['N', 'E', 'S', 'W'].forEach(function (d) { tot[d] += Number((r.tutor_dirs || {})[d]) || 0; }); });
        card.appendChild(el('p', 'compass-tutor', '튜터에게 물은 것 — ' + ['N', 'E', 'S', 'W'].map(function (d) { return SH[d] + ' ' + CC.compass.NAME[d] + ' ' + tot[d] + '번'; }).join(' · ')));
      }

      /* 미션별 한마디 — 학생에게 그대로 간다 */
      finishedOf(st).forEach(function (dbId, i) {
        var cm = clientMid(st, dbId);
        if (mid && cm !== mid && !(cu && cu.cancel && rows[0] && rows[0].missionId === dbId)) return;   /* 지워졌을 땐 고른 방향이 실릴 가장 최근 미션 칸을 늘 둔다 */
        var k = ckey(st.id, dbId), row = cRows && cRows[k];
        var form = el('div', 'compass-form');
        form.appendChild(el('h5', null, '한마디 · ' + nameOf(dbId, cm)));
        if (!row) {
          if (cTried[k] === 'fail') {
            form.appendChild(el('p', 'recap-fail', COMPASS_FAIL));
            var ag = el('button', 'pill compass-reread', '다시 읽기'); ag.type = 'button';
            ag.addEventListener('click', function () { analyze(st, dbId, false); });
            form.appendChild(ag);
          } else form.appendChild(el('p', 'emptyrow', '읽고 있어요.'));
          todo.appendChild(form);
          return;
        }
        var tid = 'cp-note-' + n + '-' + i;
        var l2 = el('label', null, '한마디 — 학생에게 그대로 보여요.'); l2.htmlFor = tid;
        var ta = el('textarea'); ta.id = tid; ta.rows = 3; ta.maxLength = 300;
        ta.value = k in cDraft ? cDraft[k] : row.sent_at ? (row.teacher_note || '') : '';
        ta.addEventListener('input', function () { cDraft[k] = ta.value; });
        var msg = el('p', 'compass-msg'); msg.setAttribute('aria-live', 'polite'); msg.textContent = cFail[k] || '';
        var acts = el('div', 'compass-acts');
        var send = el('button', 'pill compass-send', '보내기'); send.type = 'button'; send.disabled = !!cSending[k];
        var re = el('button', 'pill compass-reread', '다시 읽기'); re.type = 'button';
        send.addEventListener('click', function () {
          if (!ta.value.trim()) { msg.textContent = '한마디를 적어 주세요.'; return; }
          var body = { classroomId: cRoom, studentId: st.id, missionId: dbId, note: ta.value };
          /* 고른 방향은 가장 최근 미션 행에만 싣는다 — 서버는 그 행의 선택으로 누적을 다시 계산한다 */
          if (cu && cu.cancel && rows[0] && rows[0].missionId === dbId && (cu.candidates || []).indexOf(cPick[st.id]) >= 0) body.dir = cPick[st.id];
          send.disabled = true; cSending[k] = true; delete cFail[k];
          CC.sb.compass('send', body).then(function (r) {
            cRows[k] = r; delete cDraft[k];
            if (body.dir) delete cPick[st.id];
            return refreshCum(st, false);
          }, function () { cFail[k] = '지금은 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.'; })   /* 다시 그려도 남도록 칸별로 기억한다 */
            .then(function () { delete cSending[k]; draw(); renderFolders(); });
        });
        if (cTried[k] === 'run') re.disabled = true;   /* 읽는 중에 또 누르면 AI 를 두 번 부른다 */
        re.addEventListener('click', function () { if (cTried[k] === 'run') return; re.disabled = true; analyze(st, dbId, true); });
        acts.appendChild(send); acts.appendChild(re);
        [l2, ta].forEach(function (x) { form.appendChild(x); });
        form.appendChild(acts);
        form.appendChild(msg);
        if (row.sent_at) {
          var sent = el('div', 'compass-sent');
          sent.appendChild(el('span', 'tag', '보냈어요'));
          sent.appendChild(el('p', 'compass-sent-note', row.teacher_note || ''));
          form.appendChild(sent);
        }
        todo.appendChild(form);
      });
    };
    cDraw[st.id] = draw;
    draw();
    return card;
  }

  /* 레벨 테스트 기록 — 날짜 · 문제지 · 맞힌 수 · 문항별 ○/× · 레벨. 선생님 화면에만 (CLAUDE.md 예외 하나).
   * 기록에는 학생 답만 있다 — 맞음과 레벨은 여기서 core/onboard.js 정답표로 푼다. 건너뛴 기록은 테스트가 아니다 */
  function levelRecords(d, all) {
    var OB = CC.onboard;
    if (!OB || !OB.marks) return;
    var recs = all.filter(function (e) { return e.type === CC.events.T.S_ONBOARD && !e.skipped; })
      .sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    if (!recs.length) return;
    var fo = CC.kit.fold('레벨 테스트 기록');
    fo.root.classList.add('d-main', 'd-level');
    var ul = el('ul', 'lv-list');
    recs.forEach(function (e) {
      var mk = OB.marks(e.answers, e.set), n = mk.filter(Boolean).length;
      var st = OB.stage(e.answers, e.set).stage;
      var li = el('li', 'lv-rec');
      li.appendChild(el('span', 'lv-when', e.t ? new Date(e.t).toLocaleDateString('ko') : ''));
      li.appendChild(el('span', 'lv-set', '문제지 ' + (OB.SET_LABEL[e.set] || OB.SET_LABEL.mid)));
      li.appendChild(el('span', 'lv-n', n + '/' + mk.length));
      var ox = el('span', 'lv-ox', mk.map(function (ok) { return ok ? '○' : '×'; }).join(''));
      ox.setAttribute('role', 'img');
      ox.setAttribute('aria-label', '문항별 ' + mk.map(function (ok, i) { return (i + 1) + '번 ' + (ok ? '맞음' : '틀림'); }).join(', '));
      li.appendChild(ox);
      li.appendChild(el('span', 'lv-stage', st ? '레벨 ' + OB.LABEL[st] : ''));
      ul.appendChild(li);
    });
    fo.body.appendChild(ul);
    d.appendChild(fo.root);
  }

  /* 한 미션(mid)의 기록 — 단계(01~05)별 묶음. mid 가 null 이면 예전 블록 미션 기록(다른 미션 기록). 줄이 없으면 안내 한 줄 */
  function missionRecords(s, mid, all) {
    var evs = all.filter(function (e) { return mid ? e.mid === mid : !e.mid; });   /* mid 없는 기록은 예전 것 */
    var v = CC.fold.fold(evs, { id: s.id, name: s.name }) || CC.fold.empty(s.id, s.name);
    var dl = el('div');   /* 줄을 모았다가 아래에서 단계별로 나눠 담는다 */

    /* 문장형 미션 */
    if (v.sDefine) {
      var defs = evs.filter(function (e) { return e.type === 's-define' || e.type === 's-redefine'; });
      var first = defs.length ? (defs[0].choice || defs[0].to) : null;
      row(dl, '성공 조건', lastT(evs, ['s-define', 's-redefine']), function (dd) {
        dd.appendChild(document.createTextNode(v.sDefine.choice || ''));
        if (v.sDefineVer > 1) {
          mark(dd, '다시 정함');
          was(dd, '고친 횟수 ' + (v.sDefineVer - 1) + '번' + (first && first !== v.sDefine.choice ? ' · 처음: “' + first + '”' : ''));
        }
        if (v.sDefine.reason) was(dd, '이유 “' + v.sDefine.reason + '”');
      }, 2);
    }
    var paired = !!(v.sMethod && v.sCodes.length);   /* 설계 카드와 마지막 코드를 나란히 — 판단은 강사가 한다 */
    if (v.sMethod) {
      var sl = v.sMethod.slots || {};
      var cardTexts = v.sMethod.cards
        ? v.sMethod.cards.map(function (c) { return CC.cards.text(c); })
        : Object.keys(sl).map(function (k) { return sl[k]; }).filter(Boolean);  /* 예전 기록 */
      row(dl, '설계도', lastT(evs, ['s-method', 's-remethod', 's-design']), function (dd) {
        if (paired) {
          var pair = el('div', 'd-pair');
          var pc = el('div', 'd-pair-cards');
          pc.appendChild(el('span', 'sub', '고른 설계 카드'));
          pc.appendChild(document.createTextNode(cardTexts.join(' → ')));
          pair.appendChild(pc);
          var pk = el('div', 'd-pair-code');
          pk.appendChild(el('span', 'sub', '마지막으로 실행한 코드'));
          pk.appendChild(CC.kit.code(v.sCodes[v.sCodes.length - 1].code));
          pair.appendChild(pk);
          dd.appendChild(pair);
        } else dd.appendChild(document.createTextNode(cardTexts.join(' → ')));
        if (v.sMethodVer > 1) was(dd, '고친 횟수 ' + (v.sMethodVer - 1) + '번');
        if (v.sMethod.reason) was(dd, '이유 “' + v.sMethod.reason + '”');
      }, 3);
    }
    if (v.sCodes.length) {
      var lastCode = v.sCodes[v.sCodes.length - 1];
      /* 에러가 난 뒤 다른 코드로 에러 없이 돌렸는가 — 알림의 '스스로 고침'(core/alerts.js)과 같은 규칙 */
      var bad = null, fixed = false, errs = 0;
      v.sCodes.forEach(function (c) {
        if (c.error) { bad = c.code; errs++; } else if (bad !== null && c.code !== bad) fixed = true;
      });
      row(dl, '코드 실행', lastCode.t, function (dd) {
        dd.appendChild(el('span', 'sub', (paired ? '' : '마지막으로 실행한 코드 · ') + '실행 ' + v.sCodes.length + '번' + (errs ? ' · 에러 ' + errs + '번' : '')));
        if (fixed) mark(dd, '에러 뒤 스스로 고침');
        if (!paired) dd.appendChild(CC.kit.code(lastCode.code));
      }, 4);
      /* 자료마다 마지막 결과 — dataId 에는 자료 값이 들어 있다 (sentence.js lastResults 와 같은 규칙) */
      var byData = {}, order = [];
      v.sCodes.forEach(function (c) {
        if (!(c.dataId in byData)) order.push(c.dataId);
        byData[c.dataId] = { out: c.error || String(c.output || '').trim() || '출력 없음', err: !!c.error };
      });
      var m = missionOf(mid);   /* 자료 값 → 자료 이름 */
      row(dl, '자료별 결과', lastCode.t, function (dd) {
        /* 학생 04 화면의 결과 표와 같은 세 칸 — 자료 · 내용 · 결과 */
        var tb = el('table', 'd-tbl');
        var hr = el('tr');
        ['자료', '내용', '결과'].forEach(function (h) { var th = el('th', null, h); th.scope = 'col'; hr.appendChild(th); });
        tb.appendChild(el('thead')).appendChild(hr);
        var body = tb.appendChild(el('tbody'));
        order.forEach(function (val, i) {
          var inp = m && (m.inputs || []).filter(function (x) { return x.v === val; })[0];
          var tr = body.appendChild(el('tr'));
          tr.appendChild(el('td', null, inp ? inp.name : '자료 ' + (i + 1)));
          tr.appendChild(el('td', 'mono', String(val == null ? '' : val)));
          tr.appendChild(el('td', 'mono out' + (byData[val].err ? ' err' : ''), byData[val].out));
        });
        dd.appendChild(tb);
      }, 4);
    }
    /* 코드 사실 — 실행·구조로 확실한 것만, 한 줄에 하나. 판정이나 점수가 아니다 (미션 하나가 정해졌을 때만) */
    var fm = v.sCodes.length && missionOf(mid);
    if (fm && CC.facts) {
      var facts = CC.facts.of(v, fm);
      if (facts.length) {
        facts.forEach(function (f) {
          row(dl, '코드 사실', v.sProbe ? v.sProbe.t : (v.sCodes.length ? v.sCodes[v.sCodes.length - 1].t : null), function (dd) {
            dd.textContent = f.text;
            if (f.kind === 'hardcode') mark(dd, '하드코딩일 수 있어요', true);
          }, 4);
        });
      }
    }
    var judges = v.sJudges.concat(v.sCodeJudges).sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
    if (judges.length) {
      var seq = [];
      judges.forEach(function (j) { if (seq[seq.length - 1] !== j.verdict) seq.push(j.verdict); });
      var lastJ = judges[judges.length - 1];
      row(dl, '스스로 판단', lastJ.t, function (dd) {
        dd.appendChild(document.createTextNode(seq.join(' → ')));
        /* "지키지 못했다" 였다가 바뀐 경우 — 자기 결과를 스스로 깨뜨린 순간 */
        var miss = seq.indexOf('지키지 못했다');
        if (miss !== -1 && miss < seq.length - 1) mark(dd, '스스로 깨뜨림');
        /* 판단마다 한 줄 — 앞선 근거도 지우지 않는다 (예전 활동 타임라인이 보여 주던 것) */
        judges.forEach(function (j) {
          was(dd, (j.t ? hm(j.t) + ' · ' : '') + j.verdict + (j.basis ? ' “' + j.basis + '”' : ''));
        });
      }, 4);
    }
    if (v.sHelps) row(dl, '도움 요청', lastT(evs, ['s-help']), function (dd) {
      dd.textContent = v.sHelps + '번';
      var h = evs.filter(function (e) { return e.type === 's-help'; }).pop() || {};
      if (h.expected) was(dd, '기대한 결과 “' + h.expected + '”');
      if (h.stuck) was(dd, '막힌 곳 “' + h.stuck + '”');
    }, 4);
    if (v.sWrap) row(dl, '정리', lastT(evs, ['s-wrap']), function (dd) { dd.textContent = '“' + v.sWrap + '”'; }, 5);
    /* 단계마다 튜터에게 물은 횟수 — 질문 내용은 오른쪽(아래) 튜터 칸에 그대로 있다.
     * 한 미션에서 TUTOR_MANY 번을 넘으면 알림과 같은 기준으로 붉은 표시 */
    var perMid = {}, many = 0, TM = (CC.alerts && CC.alerts.TUTOR_MANY) || 5;
    v.sTutor.forEach(function (x) { perMid[x.mid] = (perMid[x.mid] || 0) + 1; many = Math.max(many, perMid[x.mid]); });
    var tsteps = [1, 2, 3, 4, 5].filter(function (st) { return v.sTutor.some(function (x) { return Number(x.step) === st; }); });
    tsteps.forEach(function (st, i) {
      var xs = v.sTutor.filter(function (x) { return Number(x.step) === st; });
      row(dl, '튜터 질문', xs[xs.length - 1].t, function (dd) {
        dd.textContent = xs.length + '번 물었어요';
        if (many >= TM && i === tsteps.length - 1) mark(dd, '한 미션에서 ' + many + '번 물음', true);   /* 표시는 한 번만 */
      }, st);
    });

    /* 블록 미션 (01·02·03·06) · 04 · 05 · 졸업 과제 — 예전 기록도 그대로 보인다 */
    if (!mid) {
      if (s.define.text !== '아직 안 정함') row(dl, '정한 성공', null, function (dd) {
        dd.textContent = s.define.text;
        if (s.redefined) mark(dd, '다시 정함');
      });
      if (s.why.text !== '아직 안 정함') row(dl, '자를 기준을 고른 이유', null, function (dd) { dd.textContent = s.why.text; });
      if (s.blocks.length) row(dl, '지금 만든 순서', null, function (dd) {
        dd.textContent = s.blocks.map(function (id) { return CC.block(id).label; }).join(' → ');
      });
      if (s.symptom) row(dl, '학생이 쓴 증상', null, function (dd) {
        dd.textContent = s.symptom.act
          ? '“' + CC.josa(s.symptom.exp, '이/가') + ' 나올 줄 알았는데 ' + CC.josa(s.symptom.act, '이/가') + ' 나왔어요”' +
            (s.symptom.blk ? ' · 의심 블록 ' + s.symptom.blk : '')
          : '“' + CC.josa(s.symptom.exp, '이/가') + ' 나올 줄 알았어요” — 실제로 뭐가 나왔는지는 못 골랐어요';
      });
      if (s.selfFound) row(dl, '스스로 판단', null, function (dd) { dd.textContent = '깨진 곳을 찾아냈어요'; mark(dd, '스스로 깨뜨림'); });
      if (s.revised) row(dl, '스스로 고친 기준', null, function (dd) {
        dd.textContent = s.revised + '번' + (s.lastRevision ? ' · 마지막 ' + s.lastRevision.from + ' → ' + s.lastRevision.to : '');
        mark(dd, '다시 정함');
      });
      if (s.cause) row(dl, '깨진 원인을 이렇게 봤어요', null, function (dd) { dd.textContent = s.cause + (s.handle ? ' → ' + s.handle : ''); });
      if (s.abstractOk !== null && s.abstractOk !== undefined) row(dl, '미션 04 · 추상화', null, function (dd) {
        dd.textContent = s.abstractOk
          ? '함수 하나로 두 업무를 다 해냈어요'
          : '값 하나를 안 빼서 두 번째 업무가 무너졌어요' +
            (s.abstractPicked ? ' (밖으로 뺀 것: ' + s.abstractPicked.map(function (k) { return SLOT_LABEL[k] || k; }).join(', ') + ')' : '');
      });
      if (s.reviewComments) row(dl, '미션 05 · 동료 검토', null, function (dd) {
        dd.textContent = '질문형 코멘트 ' + s.reviewComments + '개를 보냈어요' +
          (s.reviewGuess ? ' · 예측: ' + (s.reviewGuess.guess === 'hold' ? '버틸 것' : '깨질 것') : '');
      });
      if (s.made) row(dl, '이 학생이 만든 미션', null, function (dd) {
        dd.textContent = '“' + s.made.brief + '”';
        was(dd, '자료: ' + s.made.inputs.join(' / ') + ' · 함정 ' + s.made.traps + '개');
      });
      if (s.wrap) row(dl, '오늘 이 학생이 말할 문장', null, function (dd) { dd.textContent = s.wrap; });
    }
    /* 단계별로 묶는다 — 학생 화면의 01~05 단계 이름 그대로. 단계 안은 기록 순서 */
    var box = el('div', 'd-rows');
    [[1, '01 문제'], [2, '02 성공'], [3, '03 설계'], [4, '04 코딩'], [5, '05 정리'], [0, '']].forEach(function (g) {
      var rs = Array.prototype.filter.call(dl.children, function (r) { return Number(r.dataset.step) === g[0]; })
        .sort(function (a, b) { return (Number(a.dataset.t) || 0) - (Number(b.dataset.t) || 0) || 0; });   /* 시각 없는 줄(예전 기록)은 0 — 안정 정렬로 제자리 */
      if (!rs.length) return;
      var sec = el('section', 'd-step');
      if (g[1]) sec.appendChild(el('h5', 'd-step-h', g[1]));   /* 예전 기록은 접는 줄 제목이 이미 이름이다 */
      var gl = el('dl');
      rs.forEach(function (r) { gl.appendChild(r); });
      sec.appendChild(gl);
      box.appendChild(sec);
    });
    if (!box.children.length) box.appendChild(el('p', 'emptyrow', '아직 기록이 없어요.'));
    return box;
  }

  /* focusSection — 알림에서 열 때 이름 붙은 곳('compass' | 'tutor')으로 바로 내려가 거기에 초점을 둔다 */
  function openDetail(s, mid, focusSection) {
    var all = eventsOf(s);
    var ms = mids(all);
    var evs = mid ? all.filter(function (e) { return e.mid === mid; }) : all;
    var v = mid ? (CC.fold.fold(evs, { id: s.id, name: s.name }) || CC.fold.empty(s.id, s.name)) : s;

    var d = $('#detail');
    var opening = d.hidden;
    if (opening) detailFrom = { y: window.scrollY, id: s.id };   /* 알림으로 다른 학생·미션을 열어 다시 그릴 때는 처음 자리를 지킨다 */
    else if (detailFrom) detailFrom.id = s.id;                     /* 알림으로 다른 학생을 열면 돌아갈 타일은 그 학생 */
    d.innerHTML = '';
    var back = el('button', 'd-back', '← 학생');
    back.type = 'button';
    back.id = 'detail-back';
    back.addEventListener('click', closeDetail);
    d.appendChild(back);

    /* 머리 — 이름과 지금 상태 한 줄. 계정 일은 오른쪽 끝에 작게: 서랍을 연 이유가 아니다 */
    var head = el('header', 'd-head');
    var who = el('div', 'd-who');
    who.appendChild(el('h3', 'big-title', s.name));
    who.appendChild(el('p', 'dsub', (s.noRecord ? '아직 기록이 없어요' : '지금 ' + whereNow(s) + ' · 마지막 조작 ' + mmss(s.idleSec)) +
      (s.onboard && s.onboard.stage && CC.onboard ? ' · 레벨 ' + CC.onboard.LABEL[s.onboard.stage] : '')));
    head.appendChild(who);
    if (CC.sb && CC.sb.active() && CC._removeStudent) {   /* 교실이 서버에만 있다 — 로컬 모드에는 뺄 교실이 없다 */
      var acts = el('div', 'd-acts');
      var inRoster = (CC.classroom.roster || []).filter(function (r) { return r.id === s.id; })[0];
      if (inRoster && inRoster.login_id && CC._resetPassword) {   /* 선생님이 만든 계정만 — 이메일로 가입한 예전 학생은 아이디가 없다 */
        var rp = el('button', 'pill roster-reset', '비밀번호 다시 만들기');
        rp.type = 'button';
        rp.addEventListener('click', function () { CC._resetPassword(inRoster); });
        acts.appendChild(rp);
      }
      var rm = el('button', 'pill roster-remove', '교실에서 빼기');
      rm.type = 'button';
      rm.addEventListener('click', function () { CC._removeStudent(s); });
      acts.appendChild(rm);
      head.appendChild(acts);
    }
    d.appendChild(head);
    delete fresh[s.id];

    /* 기록 칸을 먼저 만들어 표시(marks)를 모은다 — 요약 카드가 그 표시를 쓴다. 화면 순서는 아래에서 정한다 */
    var main = el('section', 'd-main');
    main.setAttribute('aria-label', '기록');
    main.appendChild(el('h4', null, '이 학생이 한 것 — 순서대로'));
    main.appendChild(el('p', 'lead', '노란 표시는 말 걸기 좋은 순간, 붉은 표시는 살펴볼 것이에요.'));
    /* 미션마다 접는 줄 하나 — 가장 최근 미션이 위. 미션이 하나뿐이거나 알림으로 연 미션이면 열린 채 */
    var marks = [], seenFlag = {};   /* 줄에 붙은 표시 — 같은 글자는 한 번만 */
    function addFold(title, id, isOpen) {
      var box = missionRecords(s, id, all);
      Array.prototype.forEach.call(box.querySelectorAll('.k-chip'), function (m) {
        if (seenFlag[m.textContent]) return;
        seenFlag[m.textContent] = 1;
        marks.push({ txt: m.textContent, look: m.classList.contains('look') });
      });
      if (id === null && !box.querySelector('.row')) return;   /* 예전 기록이 없으면 줄도 없다 */
      var f = CC.kit.fold(title, { open: isOpen });
      f.body.appendChild(box);
      main.appendChild(f.root);
    }
    ms.slice().reverse().forEach(function (id) {
      var done = CC.fold.missionStatus(all.filter(function (e) { return e.mid === id; })) === 'done';   /* 기록의 사실 — 판정이 아니다 */
      addFold(missionName(id, ms.indexOf(id)) + ' · ' + (done ? '완료' : '아직'), id, ms.length === 1 || id === mid);
    });
    addFold('다른 미션 기록', null, !ms.length);
    if (!main.querySelector('.k-fold')) main.appendChild(el('p', 'emptyrow', '아직 기록이 없어요.'));
    /* 위에서 아래로: 요약(+나침반 할 일) → 먼저 물어볼 것 → 기록 → 레벨 → 튜터. 서랍을 열면 요약이 제일 먼저 보인다 */
    if (serverOn()) {   /* 로컬 모드에는 나침반이 없다 — 요약 카드만 */
      d.appendChild(compassCard(s, mid, function (dbId, cm) { return missionName(cm, ms.indexOf(cm)); }, marks));
      if (cRoom) refreshCum(s, !cInit);   /* 열 때마다 새로 — 다른 기기에서 보낸 것도 보이게 */
    } else d.appendChild(CC.kit.summary({ title: '눈에 띄는 것', chips: marks }));
    /* 교사가 할 말을 대신 써주지 않는다. 물어볼 질문만 고른다 */
    d.appendChild(CC.kit.note('이 학생에게 먼저 물어볼 것', nextQuestion(s)));
    d.appendChild(main);
    levelRecords(d, all);

    var side = el('section', 'd-tutor');
    side.setAttribute('aria-label', '튜터 대화 · 짚을 거리');
    side.setAttribute('aria-label', '튜터 대화 · 짚을 거리');
    side.appendChild(el('h4', null, '튜터 대화 · 짚을 거리'));
    /* 미션 하나를 끝냈고 튜터와 말을 나눴을 때만 — 미션이 하나뿐이면 고르지 않아도 그 미션이다 */
    var rmid = mid || (ms.length === 1 ? ms[0] : null);
    if (rmid && CC.sb && CC.sb.active() && CC.fold.missionStatus(evs) === 'done' && v.sTutor.length) {
      var rb = el('button', 'pill recap-go', '튜터 대화에서 뽑기');
      rb.type = 'button';
      var rout = el('div', 'recap-out');
      rout.setAttribute('aria-live', 'polite');
      recapOn(rb, rout, function () { return CC.recap.forStudent(s, rmid, eventsOf, missionOf); }, false);
      side.appendChild(rb);
      side.appendChild(rout);
    }
    side.appendChild(el('h5', null, '튜터에게 물은 것' + (v.sTutor.length ? ' (' + v.sTutor.length + '번)' : '')));
    side.appendChild(el('p', 'lead', '질문과 답을 그대로 보여 드려요.'));
    var qs = el('div', 'd-qs');
    /* 한 번 묻고 한 번 답한 것이 한 묶음. 되물음·답 안 함은 시각 옆 꼬리표로 */
    v.sTutor.forEach(function (x) {
      var q = el('div', 'q');
      var meta = el('div', 'q-meta');
      meta.appendChild(el('span', 'tm', hm(x.t)));
      var tag = x.kind === 'ask_back' ? '튜터가 되물었어요' : x.refused ? '튜터가 답하지 않았어요' : '';
      if (tag) meta.appendChild(el('span', 'tag', tag));
      q.appendChild(meta);
      var qq = el('p', 'qq'); qq.appendChild(el('span', 'who', '학생')); qq.appendChild(document.createTextNode(x.question || ''));
      var qa = el('p', 'a'); qa.appendChild(el('span', 'who', '튜터')); qa.appendChild(document.createTextNode(x.answer || ''));
      q.appendChild(qq);
      q.appendChild(qa);
      if (x.reasons && x.reasons.length) q.appendChild(el('div', 'why', x.reasons.join(' / ')));
      qs.appendChild(q);
    });
    if (!v.sTutor.length) qs.appendChild(el('p', 'emptyrow', '아직 없어요.'));
    side.appendChild(qs);
    d.appendChild(side);

    $('#dashboard').hidden = true;
    d.hidden = false;
    var target = focusSection && d.querySelector(focusSection === 'compass' ? '.compass-card' : '.d-tutor');
    if (target) {   /* 이미 열려 있어도 다시 내려간다 */
      target.tabIndex = -1;
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    } else if (opening) { window.scrollTo(0, 0); back.focus(); }
    renderFolders();
  }

  function nextQuestion(s) {
    if (s.define.trap === 'hardcode') return '“주문서가 다르게 오면 그때도 성공이라고 할 수 있을까?”';
    if (s.define.trap === 'luck') return '“오류가 안 났는데 결과가 틀렸으면, 그건 성공일까?”';
    if (s.symptom && !s.symptom.act) return '“실행 버튼 누르기 전에 뭐가 나올 것 같았어?”';
    if (s.cause && s.cause.indexOf('형식이 다른') === 0) return '입력 탓으로 판단한 학생입니다. 틀린 판단이 아니에요 — “그럼 그런 주문서가 또 오면 프로그램은 뭘 해야 할까?”로 이어가주세요.';
    if (s.why.weak) return '“그 기준이 다음 주문서에도 있을까? 어떻게 확신해?”';
    if (!s.asked && s.stage < 4) return '“지금 어디까지 확인해봤어?” — 답을 주지 말고 마지막으로 확인한 지점을 먼저 물어보세요.';
    if (s.redefined) return '성공 조건 자체를 다시 정했습니다. 문제를 다시 정의한 거라 이 수업에서 제일 깊은 수정이에요. 지금 한마디 해주세요 — 문구는 제안하지 않습니다.';
    if (s.revised) return '결과를 보고 스스로 기준을 고쳤습니다. 이게 정답을 맞힌 것보다 중요한 순간이에요. 지금 한마디 해주세요 — 문구는 제안하지 않습니다. 선생님 말이어야 효과가 있습니다.';
    if (s.selfFound) return '스스로 깨진 곳을 찾아냈습니다. 지금 한마디 해주세요. 문구는 제안하지 않습니다 — 선생님 말이어야 효과가 있습니다.';
    return '“왜 그 순서로 놓았는지 설명해줄래?”';
  }

  /* 목록으로 — 있던 자리(스크롤)와 그 학생 타일로 돌아간다 */
  var detailFrom = null;
  function closeDetail(noFocus) {
    var d = $('#detail');
    if (d.hidden) return;
    d.hidden = true;
    $('#dashboard').hidden = !$('#new-room').hidden || !$('#pick-room').hidden;   /* 교실 화면이 아닌 데서 닫으면 목록을 되살리지 않는다 */
    if (detailFrom) {
      window.scrollTo(0, detailFrom.y);
      var t = document.querySelector('.student-tile[data-id="' + detailFrom.id.replace(/["\\]/g, '') + '"]');
      if (t && noFocus !== true) t.focus({ preventScroll: true });   /* 교실을 바꿔 닫을 때는 이전 교실의 타일을 건드리지 않는다 */
      detailFrom = null;
    }
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;   /* 둘러보기가 이미 Esc 를 썼다 */
    if (!shell.esc()) closeDetail();   /* 맨 위 한 겹만 — 휴대폰 서랍·알림 화면이 열려 있으면 그것부터 */
  });

  $('#notes-toggle').addEventListener('click', function () {
    var on = document.body.classList.toggle('notes');
    this.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  /* ── 실시간 연결 안내 ────────────────────────────── */
  var MISSION_NAME = {
    m1: '미션 01 분해', m2: '미션 02 반복과 조건', m3: '미션 03 다른 세계에서',
    m6: '미션 06 세어보기'
  };

  function headline() {
    var h = document.querySelector('#class-label');
    if (h && me && me.mission && MISSION_NAME[me.mission]) {
      h.textContent = '2학년 3반 · ' + MISSION_NAME[me.mission];
    }
  }

  function liveBanner() {
    var host = $('#livebar');
    if (!host) return;
    if (me) {
      host.className = 'livebar on';
      host.innerHTML = '';
      host.appendChild(el('span', 'dot'));
      host.appendChild(el('span', 'txt',
        '학생 화면에서 들어온 진짜 기록이 아래 목록 맨 앞에 섞여 있어요. 목업 25명 + 실제 1명.'));
      /* 실제 기록이 어느 칸에도 안 들어가는 경우가 있다 (미션 04·05 만 해본 경우 등).
       * 그때도 열어볼 수 있어야 시연이 끊기지 않는다. */
      var open = el('button', 'tbtn', '내 기록 열기');
      open.type = 'button';
      open.addEventListener('click', function () { openDetail(me); });
      host.appendChild(open);

      var b = el('button', 'tbtn', '내 기록 지우기');
      b.type = 'button';
      b.addEventListener('click', function () { CC.store.clear(); location.reload(); });
      host.appendChild(b);
    } else if (CC.store && !CC.store.available()) {
      host.className = 'livebar off';
      host.textContent = '이 브라우저는 file:// 에서 저장을 막고 있어서 학생 화면과 연결되지 않습니다. ' +
        '로컬 서버(python3 -m http.server)나 GitHub Pages 에서는 실제 기록이 섞여 보여요. 지금은 목업 26명입니다.';
    } else {
      host.className = 'livebar off';
      host.textContent = '아직 학생 화면에서 들어온 기록이 없습니다. 학생 화면을 한 번 진행하고 돌아오면 ' +
        '맨 앞에 실제 기록이 섞여 보여요. 지금은 목업 26명입니다.';
    }
  }

  /* ── 교사 알림 ─────────────────────────────────── */
  var lastSnap = null;
  /* Supabase 모드는 첫 기록을 받기 전까지 첫 snap 을 만들지 않는다 (빈 목록이 첫 snap 이 되면
   * 이미 있던 일이 전부 새 알림 토스트가 된다). 교실을 고를 때마다 다시 시작한다. */
  var alertsLoaded = !(CC.sb && CC.sb.active());
  /* 확인한 알림 — CC.alertChecks(서버면 DB, 없으면 이 브라우저). 받기 전에는 첫 snap 을 만들지 않는다.
   * 알림은 '확인'을 누를 때까지 남는다 — 새로고침 · 다른 기기에서도 */
  var alertRoom = 'local', checks = null;
  function loadChecks(room) {
    alertRoom = room; checks = null;
    CC.alertChecks.load(room).catch(function () { return { since: Date.now(), keys: {} }; })   /* 못 읽으면 연 뒤에 생긴 일만 — 쏟아지지 않게 */
      .then(function (c) {
        if (alertRoom !== room) return;
        checks = c;
        if (alertsLoaded && !lastSnap) firstSnap(lastSnap = CC.alerts.snap(C.students, alertOpt()));
        retestAlerts();
      });
  }
  function unchecked(a) { return !checks.keys[CC.alerts.keyOf(a)]; }
  /* 첫 snap — 아직 확인 안 한 일을 토스트 없이 목록에 (시각은 그 일이 생긴 때) */
  function firstSnap(snap) {
    CC.alerts.pending(snap, checks.keys, checks.since).forEach(function (a) { showAlert(a, true); });
  }
  /* 늦게 온 재료(누적 바늘)로 생긴 키 — first snap 처럼 토스트 없이, 확인 안 한 것만 */
  function catchUp(st) {
    var ns = CC.alerts.snap([st], alertOpt())[st.id], one = {};
    one[st.id] = { name: ns.name, keys: {} };
    Object.keys(ns.keys).forEach(function (k) { if (!(k in lastSnap[st.id].keys)) one[st.id].keys[k] = lastSnap[st.id].keys[k] = ns.keys[k]; });
    if (checks) CC.alerts.pending(one, checks.keys, checks.since).forEach(function (a) { showAlert(a, true); });
  }
  /* 알림 재료 — 서버 모드는 DB id 로 끝낸 미션을 센다. 미션 이름은 학생 기록 안의 id 로 찾는다 */
  function alertOpt() {
    var on = serverOn();
    return {
      server: on, cancelOf: on ? cancelOf : null, eventsOf: eventsOf, missionOf: missionOf, finishedOf: on ? finishedOf : null,
      missionName: function (mid) {
        var m = missionOf(mid);
        return m && m.title ? m.title : '';
      }
    };
  }
  CC._resetAlerts = function (roomId) {
    cRoom = null; lastSnap = null; alertsLoaded = !(CC.sb && CC.sb.active()); retestShown = {};
    $('#alert-list').innerHTML = ''; $('#moments-empty').hidden = false; alCount();   /* 다른 교실의 알림을 끌고 오지 않는다 */
    loadChecks(roomId || 'local');
  };
  /* 재테스트 — 쌓인 할 일이라 첫 화면에도 띄운다. 학생·마지막 테스트당 확인할 때까지 (since 를 따르지 않는다).
   * 교실은 서버에만 있고 지정도 서버에서만 되니 로컬 모드에는 없다 */
  var retestShown = {};
  function retestAlerts() {
    if (!serverOn() || !checks) return;
    var waiting = function (s) { var r = (C.roster || []).filter(function (x) { return x.id === s.id; })[0]; return !!(r && r.levelWait); };
    CC.alerts.retest(C.students, Date.now(), waiting).forEach(function (a) {
      var k = CC.alerts.keyOf(a);
      if (retestShown[k] || !unchecked(a)) return;
      retestShown[k] = true;
      showAlert(a);
    });
  }
  /* 다시 지정하면 그 학생의 재테스트 알림은 내린다 */
  CC._dropRetest = function (sid) {
    document.querySelectorAll('#alert-list li[data-kind="retest"]').forEach(function (li) { if (li.dataset.sid === String(sid)) li.remove(); });
    if (!document.querySelector('#alert-list li')) $('#moments-empty').hidden = false;
    alCount();
  };
  CC._alertsLoaded = function (students, roomId) {
    alertsLoaded = true;
    if (roomId && roomId !== alertRoom) loadChecks(roomId);
    if (!lastSnap && checks) firstSnap(lastSnap = CC.alerts.snap(students || [], alertOpt()));
  };
  if (alertsLoaded) loadChecks('local');   /* 로컬 모드 — 교실은 하나 */

  /* 오른쪽 알림 — 이름표 · 사실 문장 · 시각. 문장은 CC.alerts.say 그대로, 칭찬 문구는 쓰지 않는다.
   * 굵게 = 아직 안 누름(이 화면을 연 동안만). 알림은 '확인'을 눌러야 내려간다 — 눌러서 학생을 열어 보는 것은 확인이 아니다:
   * '골라 주세요' · '다시 지정할까요?' 같은 알림은 열어 본 뒤에야 할 일이 시작되고, 잘못 누르거나 수업 중에 끊겨도 사라지면 안 된다 */
  var alFilter = 'all';
  function ago(t) {
    var m = Math.floor((Date.now() - t) / 60000);
    return m < 1 ? '방금' : m < 60 ? m + '분 전' : hm(t);
  }
  function alFilt(li) { li.hidden = alFilter !== 'all' && li.dataset.tag !== alFilter; }
  /* 휴대폰 막대에만 이름표별 개수 — 순위가 아니라 쌓인 할 일의 양 (스펙 "하지 않는 것") */
  function alCount() {
    var n = {};
    document.querySelectorAll('#alert-list li.new').forEach(function (li) { n[li.dataset.tag] = (n[li.dataset.tag] || 0) + 1; });
    var t = ['praise', 'look', 'info'].filter(function (k) { return n[k]; })
      .map(function (k) { return CC.alerts.TAGS[k] + ' ' + n[k] + '개'; }).join(' · ');
    $('#alerts-count').textContent = t || '새 알림이 없어요';
  }
  /* missed — 화면을 열 때 이미 있던 확인 안 한 일. 토스트 없이 목록에만, 시각은 그 일이 생긴 때 */
  function showAlert(a, missed) {
    var text = CC.alerts.say(a);
    var host = $('#toasts');
    if (host && !missed) {
      var toast = el('div', 'toast', text);
      host.appendChild(toast);
      setTimeout(function () { toast.remove(); }, 5000);
    }
    fresh[a.id] = true;
    var list = $('#alert-list');
    if (!list) return;
    var tag = CC.alerts.TAGS[a.tag] ? a.tag : 'look';
    var li = el('li', 'al-item new');
    li.dataset.tag = tag;
    li.dataset.kind = a.kind;
    li.dataset.sid = a.id;
    var b = el('button', 'al-it');
    b.type = 'button';
    var unread = el('span', 'sr-only', '새 알림, ');   /* 굵기는 눈에만 보인다 — 화면 낭독기에는 말로 */
    b.appendChild(unread);
    b.appendChild(el('span', 'al-tag ' + tag, CC.alerts.TAGS[tag]));
    b.appendChild(el('span', 'al-say', text));
    var at = (missed && a.at) || Date.now(), tm = el('time', 'al-tm', ago(at));
    tm.dataset.at = at;
    tm.dateTime = new Date(at).toISOString();
    b.appendChild(tm);
    b.addEventListener('click', function () {
      li.classList.remove('new');
      unread.remove();
      alCount();
      shell.alertsFull(false);
      var s = C.students.filter(function (x) { return x.id === a.id; })[0];
      if (s) openDetail(s, (a.dbId && clientMid(s, a.dbId)) || a.mid || undefined, a.kind === 'finish' || a.kind === 'cancel' ? 'compass' : a.kind === 'tutor-many' || a.kind === 'tutor-stuck' ? 'tutor' : undefined);
    });
    li.appendChild(b);
    var ok = el('button', 'al-ok', '확인');
    ok.type = 'button';
    ok.setAttribute('aria-label', '확인 — ' + text);
    ok.addEventListener('click', function () {
      var k = CC.alerts.keyOf(a);
      if (checks) checks.keys[k] = true;
      CC.alertChecks.check(alertRoom, k).catch(function (e) { console.warn('알림 확인 저장 실패:', e && e.message); });   /* 못 남기면 다음에 열 때 다시 뜰 뿐이다 */
      var next = li.nextElementSibling || li.previousElementSibling;
      li.remove();
      if (next) next.querySelector('.al-ok').focus(); else $('#moments-empty').hidden = false;
      alCount();
    });
    li.appendChild(ok);
    list.insertBefore(li, list.firstChild);
    while (list.children.length > 30) {   /* 넘치면 읽은 것 중 가장 오래된 것부터 — 안 읽은 알림을 먼저 버리지 않는다 */
      var read = list.querySelectorAll('li:not(.new)');
      list.removeChild(read.length ? read[read.length - 1] : list.lastChild);
    }
    alFilt(li);
    $('#moments-empty').hidden = true;
    alCount();
  }
  setInterval(function () {
    document.querySelectorAll('#alert-list time[data-at]').forEach(function (t) { t.textContent = ago(+t.dataset.at); });
  }, 30000);
  document.querySelectorAll('.al-filter').forEach(function (f) {
    f.addEventListener('click', function () {
      alFilter = f.dataset.tag;
      document.querySelectorAll('.al-filter').forEach(function (x) { x.setAttribute('aria-pressed', x === f ? 'true' : 'false'); });
      document.querySelectorAll('#alert-list li').forEach(alFilt);
    });
  });

  /* ── 화면 틀 — 왼쪽 사이드바 · 본문 · 오른쪽 알림 (2026-10-20 시안) ──
   * 넓은 화면: 사이드바 264 ↔ 72px 아이콘 줄, 알림은 접으면 노란 손잡이. 접힘은 이 브라우저에 기억한다.
   * 휴대폰(≤760): 사이드바는 ☰ 로 여는 서랍, 알림은 아래 노란 막대 → 전체 화면.
   * view: room(교실 대시보드) · new(새 교실 만들기) · pick(교실 고르기 전). 알림은 room 에서만 */
  var shell = (function () {
    var phone = window.matchMedia('(max-width: 760px)');
    var side = $('#side'), sT = $('#side-toggle'), sOpen = $('#side-open'), scrim = $('#side-scrim');
    var al = $('#alerts'), aT = $('#alerts-toggle'), handle = $('#alerts-handle'), bar = $('#alerts-bar');
    var view = serverOn() ? 'pick' : 'room', full = false, drawerOn = false;
    var alOpen = CC.prefs.get('alerts', window.innerWidth > 1100);   /* 기억이 없으면 좁은 화면은 접힌 채로 연다 */
    var folded = CC.prefs.get('side', false);

    function paintSide() {
      var p = phone.matches;
      side.classList.toggle('folded', folded && !p);
      document.body.classList.toggle('side-open', p && drawerOn);
      scrim.hidden = !(p && drawerOn);
      sOpen.setAttribute('aria-expanded', p && drawerOn ? 'true' : 'false');
      sT.setAttribute('aria-expanded', p ? (drawerOn ? 'true' : 'false') : (folded ? 'false' : 'true'));
      sT.setAttribute('aria-label', p ? '메뉴 닫기' : folded ? '메뉴 펼치기' : '메뉴 접기');
      sT.firstChild.textContent = p ? '×' : folded ? '›' : '‹';
      if (parts) isolate();
    }
    function paintAlerts() {
      var p = phone.matches, room = view === 'room';
      al.hidden = !room || (p ? !full : !alOpen);
      handle.hidden = !room || p || alOpen;
      bar.hidden = !room || !p || full;
      document.body.classList.toggle('alerts-full', room && p && full);
      aT.setAttribute('aria-expanded', al.hidden ? 'false' : 'true');
      aT.setAttribute('aria-label', p ? '알림 닫기' : '알림 접기');
      aT.firstChild.textContent = p ? '×' : '›';
      bar.setAttribute('aria-expanded', p && full ? 'true' : 'false');
      isolate();
    }
    /* 휴대폰 서랍·알림 전체 화면이 열려 있는 동안 나머지는 inert — Tab·낭독기가 뒤로 새지 않게 */
    var parts = [$('.m-bar'), side, $('#main'), al, bar, handle];
    function isolate() {
      var p = phone.matches, top = p && drawerOn ? side : p && full && view === 'room' ? al : null;
      parts.forEach(function (x) { x.inert = !!top && x !== top; });
    }
    function drawer(on) {
      if (drawerOn === on) return;
      drawerOn = on;
      paintSide();
      if (on) (side.querySelector('.room-tile[aria-current="true"]') || sT).focus();
      else if (phone.matches) sOpen.focus();
    }
    sT.addEventListener('click', function () {
      if (phone.matches) return drawer(false);
      folded = !folded;
      CC.prefs.set('side', folded);
      paintSide();
    });
    sOpen.addEventListener('click', function () { drawer(true); });
    scrim.addEventListener('click', function () { drawer(false); });
    aT.addEventListener('click', function () {
      if (phone.matches) { full = false; paintAlerts(); bar.focus(); return; }
      alOpen = false;
      CC.prefs.set('alerts', false);
      paintAlerts();
      handle.focus();
    });
    handle.addEventListener('click', function () { alOpen = true; CC.prefs.set('alerts', true); paintAlerts(); aT.focus(); });
    bar.addEventListener('click', function () { full = true; paintAlerts(); aT.focus(); });
    /* inert 는 뒤를 막을 뿐, 마지막 버튼 다음 Tab 은 주소창으로 나간다 — 열린 겹 안에서 돈다 */
    document.addEventListener('keydown', function (e) {
      var top = phone.matches && (drawerOn ? side : full ? al : null);
      if (e.key !== 'Tab' || !top) return;
      var f = Array.prototype.filter.call(top.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        function (x) { return !x.disabled && x.getClientRects().length; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!top.contains(a) || (e.shiftKey ? a === first : a === last)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    });
    /* Esc — 열린 겹 하나를 닫았으면 true (학생 상세는 그다음) */
    function esc() {
      if (drawerOn) { drawer(false); return true; }
      if (full) { full = false; paintAlerts(); bar.focus(); return true; }
      if (!phone.matches && alOpen && window.innerWidth <= 1100) { aT.click(); return true; }   /* 중간 폭에서는 알림이 본문 위에 겹친다 */
      return false;
    }
    /* 사이드바 안에서 무엇을 고르면(교실·보기) 휴대폰 서랍은 닫는다 */
    side.addEventListener('click', function (e) { if (e.target.closest('.room-tile, .main-tab, .room-new, #tour-replay, #notes-toggle')) drawer(false); });
    (phone.addEventListener ? phone.addEventListener.bind(phone, 'change') : phone.addListener.bind(phone))(function () {
      drawerOn = false; full = false; paintSide(); paintAlerts();
    });

    function setView(v) {
      view = v; full = false;
      closeDetail(true);   /* 교실을 바꾸면 이전 교실의 학생 상세는 닫는다 */
      $('#dashboard').hidden = v !== 'room';
      $('#new-room').hidden = v !== 'new';
      $('#pick-room').hidden = v !== 'pick';
      paintAlerts();
    }
    paintSide();
    setView(view);
    return { view: setView, esc: esc, alertsFull: function (on) { if (full !== on) { full = on; paintAlerts(); } } };
  })();
  CC._shellView = shell.view;

  /* ── 학생 폴더 — 가나다순만. 진도·속도로 줄 세우지 않는다 (CLAUDE.md) ── */
  function renderFolders() {
    var box = $('#student-folders');
    if (!box) return;
    box.innerHTML = '';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    C.students.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); }).forEach(function (s) {
      var t = el('button', 'tile student-tile');
      t.dataset.id = s.id;
      t.type = 'button';
      var lastAt = Date.now() - (s.idleSec || 0) * 1000;
      var f = el('span', 'folder' + (s.noRecord || lastAt < today.getTime() ? ' gray' : ''));
      f.setAttribute('aria-hidden', 'true');
      f.appendChild(el('span', 'tab'));
      f.appendChild(el('span', 'body'));
      if (fresh[s.id]) f.appendChild(el('span', 'dot'));
      t.appendChild(f);
      t.appendChild(el('span', 'name', s.name));
      t.appendChild(el('span', 'meta', s.noRecord ? '아직 기록이 없어요' : whereNow(s)));
      if (waiting(s)) t.appendChild(el('span', 'tag wait', '한마디 기다림'));
      t.addEventListener('click', function () { openDetail(s); });
      box.appendChild(t);
    });
  }

  /* ── 대시보드 렌더 (외부에서 호출 가능) ──────────── */
  function renderDashboard() {
    renderFolders();
    tiles();
    rowList('#ready', '#p-ready', C.ready(), 'hot', function (s) {
      return s.symptom
        ? '<b>' + esc(s.symptom.exp) + '</b>' + J(s.symptom.exp, '이/가') + ' 나올 줄 알았는데 <b>' +
          esc(s.symptom.act) + '</b>' + J(s.symptom.act, '이/가') + ' 나왔대요'
        : '증상을 말하고 있어요';
    });
    rowList('#half', '#p-half', C.halfAsked(), 'warm', function (s) {
      return s.symptom
        ? '<b>' + esc(s.symptom.exp) + '</b>' + J(s.symptom.exp, '을/를') + ' 기대했다고만 썼어요'
        : '';
    });
    rowList('#quiet', '#p-quiet', C.quiet(), 'calm', function (s) {
      return C.STAGES[s.stage] + ' 단계에서 멈춘 채 호출이 없어요';
    });
    rowList('#praise', '#p-praise', C.praise(), 'warm', function (s) {
      if (s.redefined) return '결과를 보고 <b>성공 조건 자체를 다시 정함</b>';
      if (s.revised) return '결과를 보고 <b>기준을 스스로 고침</b>';
      if (s.sDefineVer > 1) return '<b>성공 조건을 수정함</b> (' + (s.sDefineVer - 1) + '회)';
      if (s.sMethodVer > 1) return '<b>방법을 수정함</b> (' + (s.sMethodVer - 1) + '회)';
      if (s.sJudges.length) return '<b>자료를 판정함</b> (' + s.sJudges.length + '건)';
      return '<b>깨진 곳을 스스로 찾아냄</b>';
    });
    risk();
    funnel();

    /* 문장형 활동이 있는 학생 별도 표시 */
    var sActive = C.students.filter(function (s) { return s.sDefine || s.sRuns.length; });
    if (!(CC.sb && CC.sb.active())) {
      /* 로컬 모드 — 이 브라우저의 기록을 열어볼 문이 있어야 한다.
       * 문장형만 한 학생은 어느 명단 칸에도 안 들어갈 수 있다. */
      liveBanner();
    } else if (sActive.length) {
      var banner = document.querySelector('#livebar');
      if (banner) {
        banner.className = 'livebar on';
        banner.innerHTML = '';
        banner.appendChild(el('span', 'dot'));
        banner.appendChild(el('span', 'txt', '실제 학생 ' + sActive.length + '명의 활동이 있어요.'));
      }
    }

    if (!alertsLoaded) return;
    if (checks) {
      var nowSnap = CC.alerts.snap(C.students, alertOpt());
      if (lastSnap) CC.alerts.diff(lastSnap, nowSnap).filter(unchecked).forEach(function (a) { showAlert(a); });
      else firstSnap(nowSnap);
      lastSnap = nowSnap;
      retestAlerts();
    }
    renderFolders();
  }

  /* 로컬 모드: 학생 탭이 기록하면 브라우저가 storage 이벤트를 준다. 폴링이 필요 없다. */
  window.addEventListener('storage', function () {
    if (CC.sb && CC.sb.active()) return;
    var fresh = CC.store ? CC.store.fold('나') : null;
    C.students = C.students.filter(function (s) { return s !== me && s.id !== (fresh && fresh.id); });
    if (fresh) { me = fresh; C.students = [fresh].concat(C.students); }
    renderDashboard();
  });

  recapOn($('#recap-class'), $('#recap-class-out'), function () { return CC.recap.build(C.students, eventsOf, missionOf); }, true);

  /* 튜터 기록 CSV — 수업 개선용. 파일 만들기는 화면 일이라 여기에 둔다 */
  $('#tutor-csv').addEventListener('click', function () {
    var rows = CC.csv.tutorRows(C.students, function (mid) { var m = missionOf(mid); return m && m.title; });
    var d = new Date(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var room = ($('#dash-title').textContent || '교실').replace(/[\\/:*?"<>|\s]+/g, '-');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([CC.csv.toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'tutor-' + room + '-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* 외부에서 호출할 수 있게 노출 */
  CC._renderDashboard = renderDashboard;
  CC._closeDetail = closeDetail;

  /* 초기 렌더 */
  renderDashboard();
})(window.CC = window.CC || {});
