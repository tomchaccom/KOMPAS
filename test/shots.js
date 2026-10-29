/* 수업-흐름 그림 다시 찍기 — docs/수업-흐름.md 에 붙는 화면 갈무리를 가짜 데이터로 찍는다.
 *
 * 테스트가 아니라 문서 만드는 도구지만, 화면을 실제로 조작해서 찍기 때문에
 * 여기 있는 게 깨지면 화면도 깨진 것이다. test/ 에 두는 이유가 그것이다.
 * 서버는 하나도 부르지 않는다 — Supabase 는 가짜 CC.sb 로, /api/* 는 route 로 바꿔 끼운다
 * (test/e2e-flow.spec.js 와 같은 방식). 이름·아이디·문장은 모두 지어낸 것이다.
 *
 *   python3 -m http.server 8123 &
 *   node test/shots.js                 # CC_BASE · CC_CHROME 로 주소와 브라우저를 바꾼다
 *   node test/shots.js t3-detail s8    # 이름에 이 글자가 들어간 그림만
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CC_BASE || 'http://localhost:8123';
const OUT = path.join(__dirname, '..', 'docs', '수업-흐름');
const ONLY = process.argv.slice(2);
const NOW = Date.now();
const MIN = 60e3, DAY = 864e5;

/* ── 가짜 데이터 ───────────────────────────────────────── */
const ROOMS = [{ id: 'r1', name: '1학년 3반', code: 'K3B7Q2' }, { id: 'r2', name: '방과후 코딩반', code: 'P4X9M1' }];
const ROSTER = [{ id: 's1', name: '김가은', login_id: 'k3b7q2-1' }, { id: 's2', name: '이도윤', login_id: 'k3b7q2-2' }, { id: 's3', name: '박서아', login_id: 'k3b7q2-3' }];
const NAME = Object.fromEntries(ROSTER.map(r => [r.id, r.name]));

const define = (good, trap) => ({ q: '어떤 결과가 나오면 성공일까요?', options: [
  { v: good, key: 'a' }, { v: trap, key: 'b', trap: 'hardcode' }, { v: '오류 없이 끝나면 성공', key: 'c', trap: 'luck' }] });
const M_RECEIPT = { id: 'ai-a', no: 'AI', type: 'sentence', kind: 'code', concept: 'for', stage: '분해',
  title: '영수증 합치기', situation: '민서가 동아리 간식 영수증을 모았어요. 모두 얼마를 썼는지 알아야 해요.',
  brief: '영수증 금액이 모두 얼마인지 알려 주세요.',
  define: define('영수증 금액을 모두 합친 값이 나오면 성공', '영수증 1의 답과 같은 2300이 나오면 성공'),
  inputs: [{ id: 'd01', name: '영수증 1', v: '[1500, 800]' }, { id: 'd02', name: '영수증 2', v: '[300, 1200, 450]' },
    { id: 'd03', name: '새 영수증', v: '[]', counter: true, axis: 'empty' }],
  cards: [{ label: '하나씩 꺼내기' }, { label: '모두 더하기' }, { label: '가장 큰 값 찾기', decoy: true }] };
const M_LUNCH = Object.assign({}, M_RECEIPT, { id: 'ai-b', title: '급식 메뉴 세기', concept: 'dict',
  situation: '급식 설문을 모았어요.', brief: '어떤 메뉴가 몇 표인지 알려 주세요.',
  inputs: [{ id: 'd01', name: '1반', v: "['카레', '짜장', '카레']" }, { id: 'd02', name: '2반', v: "['짜장']" },
    { id: 'd03', name: '새 반', v: "['카레 ', '카레']", counter: true }] });
const M_ROPE = Object.assign({}, M_RECEIPT, { id: 'ai-c', title: '줄넘기 기록', concept: 'if',
  situation: '줄넘기 기록을 모았어요.', brief: '100번을 넘긴 사람이 몇 명인지 알려 주세요.',
  inputs: [{ id: 'd01', name: '월요일', v: '[80, 120, 101]' }, { id: 'd02', name: '화요일', v: '[99]' },
    { id: 'd03', name: '새 기록', v: '[100]', counter: true }] });
const MISSIONS = [{ id: 'db1', data: M_RECEIPT }, { id: 'db2', data: M_LUNCH }, { id: 'db3', data: M_ROPE }];

const ev = (sid, db, ago, e) => ({ student_id: sid, mission_id: db, created_at: new Date(NOW - ago).toISOString(),
  profiles: { name: NAME[sid] }, event: Object.assign({ v: 1, t: NOW - ago }, e) });

/* 한 학생이 미션 하나를 끝까지 한 기록 */
function solved(sid, db, mid, ago, code, outs, basis, wrap, tutor) {
  const m = MISSIONS.find(x => x.id === db).data;
  const rows = [
    ev(sid, db, ago + 30 * MIN, { type: 's-define', mid, choice: m.define.options[0].v, reason: '전부 더해야 하니까', trap: null }),
    ev(sid, db, ago + 26 * MIN, { type: 's-method', mid, cards: [{ label: m.cards[0].label }, { label: m.cards[1].label }], reason: '하나씩 꺼내서 더하면 돼요' })];
  (tutor || []).forEach((t, i) => rows.push(ev(sid, db, ago + (20 - i) * MIN, Object.assign({ type: 's-tutor', mid, kind: 'syntax', refused: false, step: 4 }, t))));
  m.inputs.forEach((inp, i) => rows.push(ev(sid, db, ago + (12 - i) * MIN, { type: 's-code', mid, code, dataId: inp.v, output: outs[i], error: '' })));
  rows.push(ev(sid, db, ago + 6 * MIN, { type: 's-code-judge', mid, verdict: '지켰다', basis }));
  if (wrap) rows.push(ev(sid, db, ago + 2 * MIN, { type: 's-wrap', mid, text: wrap }));
  return rows;
}
const SUM = 'data = [1500, 800]\ntotal = 0\nfor x in data:\n    total = total + x\nprint(total)';
const TUTOR_TURNS = [
  { question: 'for 문은 어떻게 써요?', answer: '`for x in [1, 2, 3]:` 처럼 쓰면 목록에서 하나씩 꺼내 x 에 넣어요. 다음 줄은 네 칸 들여 써요.' },
  { question: '더한 값을 어디에 모아요?', answer: '반복 전에 `s = 0` 처럼 변수를 만들어 두면 반복할 때마다 더할 수 있어요. 지금 코드에서는 어디에 모으고 있어요?', kind: 'ask_back' }];
const onboardRow = (sid, ago, set, answers) => ev(sid, null, ago, { type: 's-onboard', answers, skipped: false, set });
function classEvents(answers) {
  return [
    onboardRow('s1', 64 * DAY, 'low', answers.low), onboardRow('s1', 3 * DAY, 'mid', answers.mid),
    onboardRow('s2', 62 * DAY, 'mid', answers.none),
    ...solved('s1', 'db1', 'ai-a', 2 * DAY, SUM, ['2300', '1950', '0'], '빈 영수증도 0이 나와서', '빈 영수증은 생각 못 했는데 0이 나와서 다행이었어요.', TUTOR_TURNS),
    ...solved('s1', 'db2', 'ai-b', 1 * DAY, "data = ['카레', '짜장', '카레']\ncount = {}\nfor x in data:\n    count[x] = count.get(x, 0) + 1\nprint(count)",
      ["{'카레': 2, '짜장': 1}", "{'짜장': 1}", "{'카레 ': 1, '카레': 1}"], '새 반은 카레가 둘로 나뉘었어요', '보이지 않는 공백 때문에 같은 메뉴가 둘로 세어졌어요.'),
    ...solved('s1', 'db3', 'ai-c', 40 * MIN, 'data = [80, 120, 101]\nn = 0\nfor x in data:\n    if x > 100:\n        n += 1\nprint(n)', ['2', '0', '0'], '100번은 넘긴 게 아니라서 0이 맞아요', '넘었다와 같다를 다르게 봐야 했어요.'),
    ev('s2', 'db1', 25 * MIN, { type: 's-define', mid: 'ai-a', choice: M_RECEIPT.define.options[1].v, reason: '답이 2300이니까', trap: 'hardcode' }),
    ev('s2', 'db1', 20 * MIN, { type: 's-method', mid: 'ai-a', cards: [{ label: '모두 더하기' }], reason: '더하면 돼요' })];
}

/* 나침반 서버(api/compass) 가짜 응답 — 12칸 체크 · 튜터 분포 · 누적 바늘 */
const CK = ['N1', 'N2', 'N3', 'E1', 'E2', 'E3', 'S1', 'S2', 'S3', 'W1', 'W2', 'W3'];
const checks = (oks, q) => Object.fromEntries(CK.map(k => [k, { ok: oks.includes(k), quote: (q || {})[k] || '' }]));
const cRow = (db, oks, q, td, o) => Object.assign({ studentId: 's1', missionId: db, checks: checks(oks, q), tutor_dirs: td,
  teacher_dir: null, teacher_note: null, sent_at: null }, o || {});
const C_ROWS = [
  cRow('db3', ['N1', 'N2', 'E1', 'S1', 'W1', 'W2'], { N2: '100번은 넘긴 게 아니라서', W1: '새 기록 [100] 으로 돌림' }, { N: 0, E: 0, S: 0, W: 0 }),
  cRow('db2', ['N1', 'E1', 'S1', 'S2', 'W1', 'W3'], { W3: '카레 뒤 공백을 보고 다시 돌림' }, { N: 0, E: 0, S: 0, W: 0 }, { teacher_note: '공백까지 찾아낸 과정을 다음 시간에 친구들에게 보여 줄래요?', sent_at: new Date(NOW - DAY).toISOString() }),
  cRow('db1', ['N1', 'N2', 'N3', 'E1', 'S1'], { N3: '빈 영수증도 생각해 봤어요' }, { N: 1, E: 0, S: 1, W: 0 }, { teacher_note: '빈 영수증을 먼저 떠올린 게 인상 깊었어요.', sent_at: new Date(NOW - 2 * DAY).toISOString() })];
const CUM = { cumulative: { needle_deg: 330, dir: 'N', length: 0.8, cancel: false, candidates: [], n: 3 }, rows: C_ROWS };
const CUM_CANCEL = { cumulative: { needle_deg: null, dir: null, length: null, cancel: true, candidates: ['N', 'W'], n: 3 }, rows: C_ROWS };

/* ── 가짜 Supabase (js/data/supabase.js 자리) ─────────────── */
function fakeTeacherSb(CC) {
  var P = function (v) { return Promise.resolve(v); };
  var roster = window.__roster;
  CC.sb = { active: function () { return true; },
    api: function (p, b) { return fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake' }, body: JSON.stringify(b) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || 'x'); e.status = r.status; e.body = j; throw e; } return j; }); }); },
    getUser: function () { return P({ id: 't1' }); }, getProfile: function () { return P(window.__noProfile ? null : { role: window.__role || 'teacher', name: '김선생' }); },
    onAuthChange: function () {}, signOut: function () { return P(); },
    createClassroom: function (n) { return P({ id: 'r9', name: n, code: 'Q8W2E5' }); },
    myClassrooms: function () { return P(window.__rooms); },
    getMissions: function () { return P(window.__missions || []); },
    saveMission: function () { return P({}); }, updateMission: function () { return P({}); }, deleteMission: function () { return P({}); },
    getClassroomStudents: function () { return P(roster); },
    getClassroomEvents: function () { return P(window.__evs || []); },
    createStudent: function (rid, s) { roster.push({ id: 'n' + roster.length, name: s.name, login_id: s.loginId }); return P({ loginId: s.loginId, password: 'tq7wz3kd' }); },
    resetStudentPassword: function (rid, lid) { return P({ loginId: lid, password: 'tq7wz3kd' }); },
    assignOnboard: function (rid, sid, on, set) { roster.forEach(function (r) { if (r.id === sid) { r.onboard_due = on ? new Date().toISOString() : null; r.onboard_set = on ? set : null; } }); return P(null); },
    removeStudent: function () { return P({}); },
    recap: function () { return P({ items: [] }); }, clearRecap: function () { return P(null); },
    compass: function (a, b) { return CC.sb.api('/api/compass', Object.assign({ action: a }, b)); } };
}
function fakeStudentSb(CC) {
  var P = function (v) { return Promise.resolve(v); };
  CC.sb = { active: function () { return true; },
    api: function (p, b) { return fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(function (r) { return r.json(); }); },
    getProfile: function () { return P({ role: 'student', name: '김가은' }); }, getUser: function () { return P({ id: 's1' }); },
    myClassrooms: function () { return P(window.__rooms); },
    getMissions: function (rid) { return P(rid === 'r1' ? window.__missions : []); },
    getMyEvents: function (rid, db) { return P(db ? window.__evs.filter(function (e) { return e._missionDbId === db; }) : window.__evs); },
    pushEvent: function (rid, mid, e) { e._missionDbId = mid; window.__evs.push(e); return P(null); },
    compassMine: function () { return P(window.__compass || null); },
    compassNote: function (id) { return P((window.__notes || {})[id] || null); },
    signOut: function () { return P(); }, onAuthChange: function () {} };
}
const sbBody = fn => '(' + fn.toString() + ')(window.CC = window.CC || {});';

/* ── 브라우저 ─────────────────────────────────────────── */
let browser;
async function open(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.vp || { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  await ctx.route('**/supabase-js@*/**', r => r.abort());
  if (o.sb) await ctx.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: sbBody(o.sb) }));
  for (const [url, fn] of Object.entries(o.api || {})) {
    await ctx.route('**' + url, async r => {
      const [status, body] = await fn(r.request().postDataJSON() || {});
      return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
  await ctx.addInitScript(w => { Object.assign(window, w); try { localStorage.setItem('cutcheck.prefs.theme', '"light"'); } catch (e) {} }, o.win || {});
  return page;
}
async function shot(page, name, o) {
  o = o || {};
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   /* 굵은 포커스 테두리 없이 */
    document.querySelectorAll('.toast').forEach(t => t.remove());   /* 5초 뒤 사라지는 토스트가 알림 머리를 가린다 */
  });
  await page.waitForTimeout(o.wait == null ? 400 : o.wait);
  const file = path.join(OUT, name + '.png');
  if (o.el && o.h) {   /* 긴 요소는 위쪽 h 픽셀만 */
    const b = await page.locator(o.el).first().boundingBox();
    await page.screenshot({ path: file, fullPage: true, clip: { x: b.x, y: b.y, width: b.width, height: Math.min(o.h, b.height) } });
  } else if (o.el) await page.locator(o.el).first().screenshot({ path: file });
  else {
    if (o.full) {   /* fullPage 는 고정 사이드바·알림이 가운데 떠 보인다 — 창을 글 길이만큼 늘려 찍는다 */
      const vp = page.viewportSize();
      await page.setViewportSize({ width: vp.width, height: Math.min(o.full === true ? 4000 : o.full, await page.evaluate(() => document.documentElement.scrollHeight)) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: file });
  }
  console.log('  ' + name + '.png' + (page.errs.length ? '   JS 에러: ' + page.errs.join(' | ') : ''));
  await page.context().close();
}

const ok = j => [200, j];
function compassApi(cum) {
  return { '/api/compass': b => b.action === 'list' ? ok({ rows: C_ROWS }) : b.action === 'cumulative' ? ok(cum)
    : b.action === 'analyze' ? ok(C_ROWS.find(r => r.missionId === b.missionId) || C_ROWS[0]) : [400, { error: 'x' }] };
}
async function teacher(o) {
  const page = await open({ sb: fakeTeacherSb, api: o.api, vp: o.vp,
    win: Object.assign({ __rooms: ROOMS, __missions: MISSIONS, __roster: JSON.parse(JSON.stringify(ROSTER)), __evs: o.evs || [] }, o.win) });
  await page.goto(BASE + '/teacher.html');
  if (o.room !== false) {
    await page.locator('#classroom-cards .room-tile', { hasText: '1학년 3반' }).click();
    await page.locator('.student-tile').first().waitFor();
  }
  return page;
}
async function student(o) {
  const page = await open({ sb: fakeStudentSb, api: o.api, vp: o.vp,
    win: Object.assign({ __rooms: [ROOMS[0], ROOMS[1]], __missions: MISSIONS, __evs: [{ type: 's-onboard', answers: [], skipped: true, _at: new Date(NOW - DAY).toISOString() },
      { type: 's-define', mid: 'ai-b', choice: M_LUNCH.define.options[0].v, _missionDbId: 'db2' }, { type: 's-wrap', mid: 'ai-b', text: '공백 때문에 둘로 세어졌어요.', _missionDbId: 'db2' },
      { type: 's-define', mid: 'ai-c', choice: M_ROPE.define.options[0].v, _missionDbId: 'db3' }] }, o.win) });
  await page.goto(BASE + '/sentence.html');
  return page;
}

/* 레벨 테스트 답 — 객관식은 core/onboard.js 의 채점으로 맞는 보기를 찾아 고르고, 단답형은 모르겠어요.
 * 정답표를 여기에 옮겨 적지 않는다 (onboard.js: KEY 는 그 파일 밖으로 나가지 않는다) */
function onboardAnswers() {
  const g = global.window; global.window = {};
  require('../js/core/onboard.js');
  const OB = global.window.CC.onboard; global.window = g;
  const ans = (set, nOpt) => OB.SETS[set].map(q => {
    const hit = (q.options || []).findIndex((o, i) => OB.marks([{ q: q.id, pick: i }], set)[OB.SETS[set].indexOf(q)]);   /* 객관식 답은 보기 번호 */
    return { q: q.id, pick: hit >= 0 && nOpt-- > 0 ? hit : '모르겠어요' };
  });
  return { low: ans('low', 9), mid: ans('mid', 9), none: ans('mid', 0) };
}

/* 단계별 생성 가짜 응답 */
const SG = { concept: { concept: 'for', label: '반복문 for', by: 'keyword' },
  examples: { examples: [
    { title: '영수증 합치기', situation: '동아리 간식 영수증 금액을 모두 더해요.', why: '목록에서 하나씩 꺼내 더해요' },
    { title: '줄넘기 기록', situation: '반 친구들의 줄넘기 기록에서 100번을 넘긴 사람을 세요.', why: '하나씩 보며 조건을 따져요' },
    { title: '도서관 대출', situation: '이번 주 빌린 책 권수를 요일별로 더해요.', why: '반복하며 합을 쌓아요' },
    { title: '분리수거 무게', situation: '반별 분리수거 무게에서 가장 무거운 반을 찾아요.', why: '하나씩 비교해요' }] } };
const SG_DRAFT = { draft: Object.assign({}, M_RECEIPT, { kind: 'code', solution: SUM.replace('data = [1500, 800]\n', '') }), ticket: 'tk-1', left: 2 };
function stepsApi() {
  return { '/api/mission-steps': b => b.action === 'quota' ? ok({ left: 3, disabled: false }) : b.action === 'concept' ? ok(SG.concept)
    : b.action === 'examples' ? ok(SG.examples) : b.action === 'solve' ? ok({ code: 's = 0\nfor v in data:\n    s += v\nprint(s)' })
    : b.action === 'build' ? ok(SG_DRAFT) : [400, { error: 'x' }] };
}

/* ── 그림 ─────────────────────────────────────────────── */
const SHOTS = {
  async 'a1-login'() {
    const p = await open({ sb: fakeTeacherSb, win: { __noProfile: true } }); await p.goto(BASE + '/auth.html');
    await shot(p, 'a1-login');
  },
  async 'a2-signup'() {
    const p = await open({ sb: fakeTeacherSb, win: { __noProfile: true } }); await p.goto(BASE + '/auth.html');
    await p.locator('#tab-signup').click();
    await p.locator('#signup-name').fill('김선생');
    await p.locator('#signup-email').fill('teacher@example.com');
    await shot(p, 'a2-signup');
  },
  async 'a3-create-room'() {
    const p = await open({ sb: fakeTeacherSb, win: { __rooms: [] } }); await p.goto(BASE + '/auth.html');
    await p.locator('#create-section').waitFor();
    await p.locator('#create-name').fill('1학년 3반');
    await shot(p, 'a3-create-room');
  },
  async 'a4-no-classroom'() {
    const p = await student({ win: { __rooms: [] } });
    await p.locator('.room-empty').waitFor();
    await shot(p, 'a4-no-classroom');
  },

  async 't1-rooms'(A) {
    const p = await teacher({ evs: classEvents(A), api: compassApi(CUM) });
    await p.evaluate(add => { window.__evs.push(...add); }, [
      ev('s2', 'db1', 0, { type: 's-redefine', mid: 'ai-a', to: M_RECEIPT.define.options[0].v, reason: '새 영수증이 비어 있어서', trap: null }),
      ...[1, 2, 3, 4, 5].map(i => ev('s3', 'db1', 0, { type: 's-tutor', mid: 'ai-a', question: '질문 ' + i, answer: '답', kind: 'syntax', step: 4 })),
      ev('s3', null, 0, { type: 's-onboard', answers: A.mid, skipped: false, set: 'mid' })]);
    await p.locator('#alert-list li[data-tag="look"]').first().waitFor({ timeout: 9000 });
    await shot(p, 't1-rooms');
  },
  /* /slide2 시연의 비상용 — 학생이 05 를 마친 순간 강사 오른쪽에 '칭찬 타이밍 · 미션 마침' 이 뜬다 */
  async 't8-finish-alert'(A) {
    const p = await teacher({ evs: classEvents(A), api: compassApi(CUM) });
    await p.evaluate(add => { window.__evs.push(...add); }, [
      ev('s2', 'db1', 0, { type: 's-code-judge', mid: 'ai-a', verdict: 'kept', basis: '새 영수증은 비어 있는데 0이 나왔어요' }),
      ev('s2', 'db1', 0, { type: 's-wrap', mid: 'ai-a', text: '빈 영수증도 생각해야 했어요.' })]);
    await p.locator('#alert-list li[data-tag="praise"]').first().waitFor({ timeout: 9000 });
    await shot(p, 't8-finish-alert');
  },
  async 't2-students'(A) {
    const p = await teacher({ evs: classEvents(A), api: compassApi(CUM) });
    await p.locator('.student-tile .tag.wait').first().waitFor({ timeout: 8000 }).catch(() => {});
    await shot(p, 't2-students');
  },
  async 't3-detail'(A) {
    /* 긴 화면이라 창을 키워 나침반 카드 끝(한마디 칸)까지 담는다 — fullPage 는 고정 사이드바가 가운데 떠 보인다 */
    const p = await teacher({ evs: classEvents(A), api: compassApi(CUM), vp: { width: 1280, height: 1760 } });
    await p.locator('.student-tile', { hasText: '김가은' }).click();
    await p.locator('#detail .compass-table').waitFor({ timeout: 8000 });
    await p.locator('#detail .compass-form', { hasText: '줄넘기 기록' }).locator('textarea').fill('100번 경계를 직접 돌려 본 게 좋았어요.');
    await p.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    await shot(p, 't3-detail');
  },
  async 't3-cancel'(A) {
    const p = await teacher({ evs: classEvents(A), api: compassApi(CUM_CANCEL) });
    await p.locator('.student-tile', { hasText: '김가은' }).click();
    await p.locator('#detail .compass-cand').first().waitFor({ timeout: 8000 });
    await p.locator('#detail .compass-cand').first().click();
    await shot(p, 't3-cancel', { el: '#detail .compass-card', h: 560 });
  },
  async 't7-level-record'(A) {
    const p = await teacher({ evs: classEvents(A), api: compassApi(CUM) });
    await p.locator('.student-tile', { hasText: '김가은' }).click();
    await p.locator('#detail .d-level > summary').click();   // 레벨 기록은 접는 줄 안 — 펼쳐서 찍는다
    await p.locator('#detail .lv-rec').first().waitFor();
    await p.locator('#detail .d-level').scrollIntoViewIfNeeded();
    await shot(p, 't7-level-record', { el: '#detail .d-level' });
  },
  async 't4-missions'(A) {
    const p = await teacher({ evs: classEvents(A), api: stepsApi() });
    await p.locator('.main-tab[data-dtab="dtab-missions"]').click();
    await p.locator('#gen-lesson').fill('리스트와 for 반복문');
    await p.locator('#gen-key').fill('목록에서 하나씩 꺼내 더하기');
    await shot(p, 't4-missions', { full: 1000 });
  },
  async 't5-stepwise-2-examples'(A) {
    const p = await teacher({ evs: classEvents(A), api: stepsApi() });
    await p.locator('.main-tab[data-dtab="dtab-missions"]').click();
    await p.locator('#gen-lesson').fill('리스트와 for 반복문');
    await p.locator('#gen-key').fill('목록에서 하나씩 꺼내 더하기');
    await p.locator('#sg-concept').click();
    await p.locator('#sg-next').click();
    await p.locator('.sg-ex').nth(0).click();
    await shot(p, 't5-stepwise-2-examples', { full: 1300 });
  },
  async 't5-stepwise-4-draft'(A) {
    const p = await teacher({ evs: classEvents(A), api: stepsApi() });
    await p.locator('.main-tab[data-dtab="dtab-missions"]').click();
    await p.locator('#gen-lesson').fill('리스트와 for 반복문');
    await p.locator('#gen-key').fill('목록에서 하나씩 꺼내 더하기');
    await p.locator('#sg-concept').click();
    await p.locator('#sg-next').click();
    await p.locator('.sg-ex').nth(0).click();
    await p.locator('#sg-build').click();
    await p.locator('.sg-answer').nth(2).filter({ hasText: /\d/ }).waitFor({ timeout: 90000 });
    await p.waitForTimeout(1500);
    await shot(p, 't5-stepwise-4-draft', { full: true });
  },
  async 't5-invite'(A) {
    const p = await teacher({ evs: classEvents(A) });
    await p.locator('.main-tab[data-dtab="dtab-invite"]').click();
    await p.locator('#ns-name').fill('최하준');
    await p.locator('.roster-row', { hasText: '박서아' }).locator('.roster-set').selectOption('low');
    await shot(p, 't5-invite');
  },
  async 't6-credentials'(A) {
    const p = await teacher({ evs: classEvents(A) });
    await p.locator('.main-tab[data-dtab="dtab-invite"]').click();
    await p.locator('#ns-name').fill('최하준');
    await p.locator('#ns-go').click();
    await p.locator('#ns-result .cred').waitFor();
    await shot(p, 't6-credentials');
  },

  async 's1-rooms'() {
    const p = await student({});
    await p.locator('.room-tile').first().waitFor();
    await shot(p, 's1-rooms');
  },
  async 's2-onboard'() {
    const p = await student({ win: { __evs: [] } });
    await p.locator('.room-tile').first().click();
    await p.locator('#ob-count').waitFor();
    await shot(p, 's2-onboard');
  },
  async 's3-missions'() {
    const p = await student({});
    await p.locator('.room-tile').first().click();
    await p.locator('.mission-file').first().waitFor();
    await shot(p, 's3-missions');
  },
  async 's4-step1-problem'() { await studentFlow('s4-step1-problem'); },
  async 's5-step2-success'() { await studentFlow('s5-step2-success'); },
  async 's6-step3-design'() { await studentFlow('s6-step3-design'); },
  async 's7-step4-code'() { await studentFlow('s7-step4-code'); },
  async 's8-tutor'() { await studentFlow('s8-tutor'); },
  async 's9-step5-wrap'() { await studentFlow('s9-step5-wrap'); },
  async 's10-phone'() { await studentFlow('s10-phone', { width: 390, height: 844 }); },
  async 's11-my-compass'() {
    const t = NOW - DAY, mine = e => Object.assign({ v: 1, mid: 'ai-a', _missionDbId: 'db1' }, e);
    const p = await student({ win: { __compass: { needle_deg: 330, dir: 'N', length: 0.8, sent_at: 't' }, __evs: [
      { type: 's-onboard', answers: [], skipped: true, _at: new Date(NOW - 2 * DAY).toISOString() },
      mine({ type: 's-define', choice: M_RECEIPT.define.options[0].v, reason: '전부 더해야 하니까', t }),
      mine({ type: 's-method', cards: [{ label: '하나씩 꺼내기' }, { label: '모두 더하기' }], reason: '하나씩 꺼내서 더하면 돼요', t: t + MIN }),
      ...M_RECEIPT.inputs.map((inp, i) => mine({ type: 's-code', code: SUM, dataId: inp.v, output: ['2300', '1950', '0'][i], error: '', t: t + (5 + i) * MIN })),
      mine({ type: 's-code-judge', verdict: '지켰다', basis: '새 영수증은 비어 있는데 0이 나와서', t: t + 9 * MIN }),
      mine({ type: 's-wrap', text: '빈 영수증은 생각 못 했는데 0이 나와서 다행이었어요.', t: t + 10 * MIN })] } });
    await p.locator('.room-tile').first().click();
    await p.locator('.mission-file').first().click();
    await p.locator('.main-tab[data-panel="panel-history"]').click();
    await p.locator('#compass-cum svg').waitFor();
    await shot(p, 's11-my-compass', { full: 1200 });
  },
  async 's12-teacher-note'() {
    const p = await student({ win: { __notes: { db1: { teacher_note: '빈 영수증을 먼저 떠올린 게 인상 깊었어요.', sent_at: 't' } } } });
    await p.locator('.room-tile').first().click();
    await p.locator('.mission-file').first().click();
    await p.locator('#compass-mine .compass-note').waitFor();
    await shot(p, 's12-teacher-note');
  },

  async 'x1-admin'() {
    const list = { default_quota: 3, teachers: [
      { id: 't1', name: '김선생', email: 'teacher@example.com', used: 1, quota: 3, left: 2, disabled: false },
      { id: 't2', name: '이선생', email: 'teacher2@example.com', used: 3, quota: 3, left: 0, disabled: false },
      { id: 't3', name: '박선생', email: 'teacher3@example.com', used: 0, quota: 5, left: 5, disabled: true }] };
    const log = { log: [
      { at: new Date(NOW - 30 * MIN).toISOString(), teacher: '김선생', lesson: '리스트와 for 반복문', concept: 'for', kind: 'step', retries: 0 },
      { at: new Date(NOW - DAY).toISOString(), teacher: '이선생', lesson: '딕셔너리로 세기', concept: 'dict', kind: 'step', retries: 1 },
      { at: new Date(NOW - 2 * DAY).toISOString(), teacher: '이선생', lesson: '조건문', concept: 'if', kind: 'quick', retries: 0 }] };
    const p = await open({ sb: fakeTeacherSb, win: { __rooms: ROOMS, __roster: ROSTER, __role: 'admin' },
      api: { '/api/admin': b => b.action === 'list' ? ok(list) : b.action === 'log' ? ok(log) : [400, { error: 'x' }] } });
    await p.goto(BASE + '/admin.html');
    await p.locator('#ad-teachers tbody tr').first().waitFor();
    await shot(p, 'x1-admin');
  }
};

/* 학생 미션 한 번 — 원하는 단계에서 멈춰 찍는다 */
async function studentFlow(name, vp) {
  const tutorAnswer = '`for x in [3, 5]:` 처럼 쓰면 목록에서 값을 하나씩 꺼내 x 에 넣어요. 더한 값을 모으려면 반복 전에 `s = 0` 을 만들고, 안에서 `s = s + x` 처럼 써요.';
  const p = await student({ vp, api: { '/api/tutor': () => ok({ kind: 'syntax', answer: tutorAnswer, refused: false }) } });
  const at = n => name.startsWith(n);
  const H = { s4: 900, s5: 900, s6: 1000, s7: 1700, s8: 1150, s9: 1600 };
  const snap = (pg, n) => shot(pg, n, { full: H[n.split('-')[0]] });
  await p.locator('.room-tile').first().click();
  await p.locator('.mission-file').first().click();
  await p.locator('#go-define').waitFor();
  if (at('s4')) return snap(p, name);
  await p.locator('#go-define').click();
  await p.locator('.define-card').first().click();
  await p.locator('#reason-define').fill('영수증마다 금액이 달라도 다 더해야 하니까요');
  if (at('s5')) return snap(p, name);
  await p.locator('#go-method').click();
  await p.locator('.card-pick', { hasText: '하나씩 꺼내기' }).click();
  await p.locator('.card-pick', { hasText: '모두 더하기' }).click();
  await p.locator('#reason-method').fill('하나씩 꺼내서 계속 더하면 돼요');
  if (at('s6')) return snap(p, name);
  await p.locator('#go-run').click();
  await p.locator('#pyodide-status').filter({ hasText: 'Python 준비 완료' }).waitFor({ timeout: 90000 });
  await p.locator('#code-editor').fill(SUM + '\n');
  await p.locator('#run-all').click();
  await p.locator('#code-table tbody tr').nth(2).waitFor({ timeout: 30000 });
  if (at('s8') || at('s10')) {
    if (await p.locator('#tutor-open').isVisible()) await p.locator('#tutor-open').click();
    await p.locator('#tutor-q').fill('for 문으로 더하려면 어떻게 써요?');
    await p.locator('#tutor-send').click();
    await p.locator('.tutor-msg.ai .tutor-code').first().waitFor();
    if (at('s10')) { await p.locator('#tutor-close').click().catch(() => {}); await p.evaluate(() => window.scrollTo(0, document.querySelector('#code-table').getBoundingClientRect().top + scrollY - 200)); }
    return snap(p, name);
  }
  await p.locator('#code-judge .judge-btn').first().click();
  await p.locator('#code-basis').fill('새 영수증은 비어 있는데 0이 나와서 지켰어요');
  if (at('s7')) return snap(p, name);
  await p.locator('#code-judge-save').click();
  await p.locator('#go-wrap').click();
  await p.locator('#wrap-text').fill('빈 영수증은 생각 못 했는데 0이 나와서 다행이었어요.');
  return snap(p, name);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch(process.env.CC_CHROME ? { executablePath: process.env.CC_CHROME } : {});
  const A = onboardAnswers();
  let fail = 0;
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (ONLY.length && !ONLY.some(o => name.includes(o))) continue;
    try { await fn(A); } catch (e) { fail++; console.log('  ✗ ' + name + ' — ' + e.message.split('\n')[0]); }
  }
  await browser.close();
  if (fail) { console.log('\n' + fail + '장을 못 찍었어요.'); process.exit(1); }
})();
