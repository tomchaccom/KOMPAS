/* test/e2e-flow.spec.js — 핵심 흐름 한 번에
 *
 * 교사 미션 생성 → 학생 해결 → 설계도 → 파이썬 코드 → 완료 → 교사 화면.
 * LLM 은 고정 응답으로 바꾼다 — 테스트가 API 키와 비용에 묶이지 않게.
 * Supabase 는 막아 로컬 모드로 돈다 — 테스트가 실제 교실 DB 에 쓰면 안 된다.
 *
 *   python3 -m http.server 8123
 *   npx playwright test test/e2e-flow.spec.js
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.CC_BASE || 'http://localhost:8123';   // 다른 작업 폴더가 8123 을 쓰고 있으면 CC_BASE 로 바꾼다

async function local(ctx) {
  await ctx.route('**/supabase-js@*/**', r => r.abort());
}

/* 교사가 확정한 미션은 localStorage 'cutcheck.generated' 로 학생 화면에 간다 (teacher.html 확정 버튼).
 * 기본 미션 하나를 복제해 같은 경로로 넣는다. */
async function seedMission(page) {
  await page.goto(BASE + '/sentence.html');
  await page.evaluate(() => {
    const m = JSON.parse(JSON.stringify(window.CC.SENTENCE_MISSIONS[0]));
    m.id = 'ai-e2e'; m.no = 'AI'; m.title = '시험용 미션';
    localStorage.setItem('cutcheck.generated', JSON.stringify([m]));
    window.CC.store.clear();
  });
  await page.reload();
}

/* 카드 화면: 진짜 카드를 순서대로 놓고 세부를 고른다. 시험용 미션은 split-unique-count (sm1 복제) */
async function pickCards(page) {
  for (const label of ['나누기', '겹친 것은 하나만', '개수 세기']) {
    await page.locator('.card-pick', { hasText: label }).click();
  }
  await page.locator('.design-item select').first().selectOption('쉼표');
}

async function studentToCode(page) {
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('모두 세야 하니까');
  await page.locator('#go-method').click();
  await pickCards(page);
  await page.locator('#reason-method').fill('보이는 대로');
  await page.locator('#go-run').click();
  await expect(page.locator('#step4')).toHaveClass(/active/);
}

async function waitPython(page) {
  await expect(page.locator('#pyodide-status')).toHaveText('Python 준비 완료', { timeout: 60000 });
}

test('교사 화면에서 초안을 만들 수 있다 (LLM 고정 응답)', async ({ context, page }) => {
  await local(context);
  const fixture = require('./fixtures/mission.json');
  const draft = { ...fixture, guard: { ...(fixture.guard || {}), fallback: [], reasons: {},
    review: { status: 'teacher', reasons: ['세 자료가 같은 이야기인가 — 셋째만 문구예요'], rounds: 3 } } };
  delete draft.method;
  await page.route('**/api/generate-mission', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(draft)
  }));
  await page.goto(BASE + '/teacher.html');
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#gt-quick').click();
  const gen = page.locator('#gen-btn');
  await page.locator('#gen-lesson').fill('리스트와 반복문');
  await page.locator('#gen-key').fill('같은 값이 여러 번 나올 때');
  await gen.click();
  await expect(page.locator('#confirm-mission')).toBeVisible();
  await expect(page.locator('#gen-result')).toContainText('검수 필요');
  await expect(page.locator('#gen-result')).toContainText('셋째만 문구예요');
  await expect(page.locator('#gen-result')).toContainText('없어도 되는 카드');
});

test('학생 해결 → 설계도 → 코드 → 완료 → 교사 화면', async ({ context, page }) => {
  test.setTimeout(120000);
  await local(context);
  await seedMission(page);
  await studentToCode(page);

  await expect(page.locator('#design-define')).toContainText('성공');
  await waitPython(page);
  await page.locator('#code-editor').fill('data = "a,b,a"\nprint(len(data.split(",")))\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toHaveText('3', { timeout: 10000 });

  await page.locator('#code-judge .judge-btn').first().click();
  await page.locator('#code-basis').fill('세 개가 나와서');
  await page.locator('#code-judge-save').click();
  await page.locator('#go-wrap').click();
  await page.locator('#wrap-text').fill('처음 생각보다 나눌 게 많았다.');
  await page.locator('#finish').click();

  const t = await context.newPage();
  await t.goto(BASE + '/teacher.html');
  await t.getByRole('button', { name: '내 기록 열기' }).click();
  await expect(t.locator('body')).toContainText('코드 실행');
  await expect(t.locator('body')).toContainText('처음 생각보다 나눌 게 많았다.');
});

test('학생이 설계도를 내면 교사 화면에 알림이 뜬다', async ({ context, page }) => {
  await local(context);
  await seedMission(page);
  const t = await context.newPage();
  await t.goto(BASE + '/teacher.html');
  await expect(t.locator('.toast')).toHaveCount(0);     // 처음 연 때는 조용하다
  await studentToCode(page);
  await expect(t.locator('.toast')).toContainText('설계도를 냈어요.', { timeout: 5000 });
  await expect(t.locator('#alert-list li')).toHaveCount(1);
  await t.reload();
  await expect(t.locator('.toast')).toHaveCount(0);     // 새로고침해도 쏟아지지 않는다
});

/* 알림에 칭찬 문장이 없다 — 힌트 줄까지 본다. '칭찬'은 이름표·고르기 칩에서만 허용 */
async function noPraise(p) {
  await expect(p.locator('#alerts')).not.toContainText(/잘했|훌륭|최고/);
  expect(await p.evaluate(() => { const c = document.querySelector('#alerts').cloneNode(true); c.querySelectorAll('.al-tag, .al-filter').forEach(n => n.remove()); return c.textContent; })).not.toMatch(/칭찬/);
}

test('강사 홈 — 학생은 가나다순 폴더, 말 걸 순간은 사실만', async ({ context, page }) => {
  test.setTimeout(120000);
  await local(context);
  await seedMission(page);
  const t = await context.newPage();
  await t.goto(BASE + '/teacher.html');            // 먼저 열어 둔다 — 알림은 연 뒤에 생긴 제출만 뜬다
  await studentToCode(page);                       // 설계도를 낸다
  const names = await t.locator('.student-tile .name').allInnerTexts();
  expect(names.length).toBeGreaterThan(0);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'ko')));   // 가나다순만
  await expect(t.locator('#alerts')).toContainText('설계도를 냈어요', { timeout: 5000 });
  await noPraise(t);
  await expect(t.locator('details.more')).toBeAttached();                       // 분석 패널은 접혀서 남는다
});

test('학생 서랍 — 스스로 판단은 판단마다 근거가 남는다', async ({ context, page }) => {
  await local(context);
  await page.goto(BASE + '/sentence.html');
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('cutcheck.log.v1', JSON.stringify([
      { v: 1, type: 's-code-judge', verdict: '지키지 못했다', basis: '첫 근거 6이 나와서', t: now - 60000, mid: 'sm1' },
      { v: 1, type: 's-code-judge', verdict: '지켰다', basis: '둘째 근거 겹친 걸 뺐다', t: now, mid: 'sm1' }
    ]));
  });
  await page.goto(BASE + '/teacher.html');
  await page.getByRole('button', { name: '내 기록 열기' }).click();
  const d = page.locator('#detail');
  await expect(d).toContainText('첫 근거 6이 나와서');
  await expect(d).toContainText('둘째 근거 겹친 걸 뺐다');
  await expect(d).toContainText('스스로 깨뜨림');
});

test('튜터는 설계도를 낸 뒤 코드 단계에서만 보인다', async ({ context, page }) => {
  await local(context);
  await seedMission(page);
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await expect(page.locator(TUTOR_ANY)).toHaveCount(0);
  await page.locator('#go-define').click();
  await expect(page.locator(TUTOR_ANY)).toHaveCount(0);
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('이유 적기');
  await page.locator('#go-method').click();
  await expect(page.locator(TUTOR_ANY)).toHaveCount(0);
  await pickCards(page);
  await page.locator('#reason-method').fill('이유 적기');
  await page.locator('#go-run').click();
  await expect(page.locator(TUTOR_ANY)).toHaveCount(1);
  await page.locator('#back-method').click();
  await expect(page.locator(TUTOR_ANY)).toHaveCount(0);
});

test('튜터: 서버가 없으면 쓸 수 없다고만 말하고, 있으면 답한다', async ({ context, page }) => {
  await local(context);
  await seedMission(page);
  await studentToCode(page);
  await openTutor(page);
  await page.locator('#tutor-q').fill('split 이 뭐예요?');
  await page.locator('#tutor-send').click();
  await expect(page.locator('.tutor-msg.ai').last()).toHaveText('지금은 튜터를 쓸 수 없어요.');

  await page.route('**/api/tutor', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ kind: 'syntax', answer: '`"a b".split()` 처럼 쓰면 나눈 목록이 나와요.', refused: false }) }));
  await page.locator('#tutor-q').fill('split 이 뭐예요?');
  await page.locator('#tutor-send').click();
  await expect(page.locator('.tutor-msg.ai').last()).toContainText('나눈 목록');
  const evs = await page.evaluate(() => JSON.parse(localStorage.getItem('cutcheck.log.v1') || '[]'));
  expect(evs.filter(e => e.type === 's-tutor').length).toBe(2);
});

/* 튜터 대화창 — 보통 채팅처럼. 미션마다 대화가 하나, 기록은 s-tutor 이벤트에서 다시 그린다 */
async function mockTutor(page, calls) {
  await page.route('**/api/tutor', r => {
    const body = r.request().postDataJSON();
    calls.push(body);
    return r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ kind: 'ask_back', answer: '답: ' + body.question + '?', refused: false }) });
  });
}


/* 튜터는 접혀 있으면 #tutor-open(손잡이), 펼쳐 있으면 #tutor(aside) 하나만 보인다. 접혀 있을 때만 펼친다 */
const TUTOR_ANY = '#tutor:visible, #tutor-open:visible';
async function openTutor(page) {
  if (await page.locator('#tutor-open').isVisible()) await page.locator('#tutor-open').click();
  await expect(page.locator('#tutor')).toBeVisible();
}

test('튜터 사이드바(넓은 화면): 본문 오른쪽 aside, 본문은 계속 눌린다, 접고 펴도 대화가 남는다', async ({ context, page }) => {
  await local(context);
  const calls = [];
  await mockTutor(page, calls);
  await seedMission(page);
  await studentToCode(page);
  const side = page.locator('#tutor');
  await expect(side).toBeVisible();
  expect(await side.evaluate(e => e.tagName + e.open)).toBe('ASIDEundefined');
  await expect(page.locator('#tutor-open')).toBeHidden();
  // 4단계에 들어오면 입력창이 바로 보인다 (접힌 아래에 있지 않다)
  await expect.poll(() => page.locator('#tutor-send').evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
  const a = await side.boundingBox(), m = await page.locator('#step4').boundingBox();
  expect(a.x).toBeGreaterThanOrEqual(m.x + m.width - 1);
  expect(a.width).toBeLessThanOrEqual(400);
  await page.locator('#tutor-q').fill('split?');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tutor-msg.ai')).toHaveText(['답: split??']);
  // 모달이 아니다 — 본문을 바로 누를 수 있다
  await page.locator('#step4-brief summary').click();
  await expect(page.locator('#step4-brief')).not.toHaveAttribute('open', '');
  await page.locator('#tutor-close').click();
  await expect(side).toBeHidden();
  await expect(page.locator('#tutor-open')).toHaveAttribute('aria-expanded', 'false');
  const h = await page.locator('#tutor-open').boundingBox();
  expect(h.width).toBeGreaterThanOrEqual(44);
  await page.reload();  // 접힘은 이 브라우저가 기억한다
  await toCode(page, 'ai-e2e');
  await expect(page.locator('#tutor-open')).toBeVisible();
  await page.locator('#tutor-open').click();
  await expect(page.locator('#tutor-close')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.tutor-msg.ai')).toHaveText(['답: split??']);
});

test('튜터 사이드바: 채팅 전에 접었다 펴도 입력창이 열린다', async ({ context, page }) => {
  await local(context);
  await seedMission(page);
  await studentToCode(page);
  await page.locator('#tutor-close').click();
  await expect(page.locator('#tutor')).toBeHidden();
  await expect(page.locator('#tutor-open')).toBeVisible();
  await page.locator('#tutor-open').click();
  await expect(page.locator('#tutor')).toBeVisible();
  await expect(page.locator('#tutor-open')).toBeHidden();
  await expect(page.locator('#tutor-q')).toBeFocused();
});

test('튜터 사이드바(휴대폰): 아래 막대로 열면 전체 화면, 닫으면 막대로 돌아온다', async ({ context, page }) => {
  await local(context);
  await page.setViewportSize({ width: 390, height: 800 });
  await seedMission(page);
  await studentToCode(page);
  const bar = page.locator('#tutor-open');
  await expect(page.locator('#tutor')).toBeHidden();
  await expect(bar).toHaveText('튜터에게 묻기');
  const b = await bar.boundingBox();
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.y + b.height).toBeGreaterThan(700);
  await bar.click();
  await expect(page.locator('#tutor-q')).toBeFocused();
  // 뒤 화면은 막혀 있다 — Tab 을 아무리 눌러도 사이드바 밖(뒤 화면)으로 못 나간다
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#tutor') || document.activeElement === document.body)).toBe(true);
  }
  await page.locator('#tutor-q').focus();
  const a = await page.locator('#tutor').boundingBox();
  expect(a.width).toBeGreaterThanOrEqual(389);
  expect(a.height).toBeGreaterThanOrEqual(799);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tutor')).toBeHidden();
  await expect(bar).toBeFocused();
  await bar.click();
  await page.locator('#tutor-close').click();
  await expect(bar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

/* 두 번째 미션 — 시험용 미션을 하나 더 복제해 같은 경로로 넣는다 */
async function seedTwoMissions(page) {
  await page.goto(BASE + '/sentence.html');
  await page.evaluate(() => {
    const a = JSON.parse(JSON.stringify(window.CC.SENTENCE_MISSIONS[0]));
    a.id = 'ai-e2e'; a.title = '시험용 미션';
    const b = JSON.parse(JSON.stringify(a)); b.id = 'ai-e2e-b'; b.title = '둘째 미션';
    localStorage.setItem('cutcheck.generated', JSON.stringify([a, b]));
    window.CC.store.clear();
  });
  await page.reload();
}

async function toCode(page, id) {
  await page.locator('.m-btn[data-id="' + id + '"]').click();
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('이유 적기');
  await page.locator('#go-method').click();
  await pickCards(page);
  await page.locator('#reason-method').fill('이유 적기');
  await page.locator('#go-run').click();
  await expect(page.locator(TUTOR_ANY)).toHaveCount(1);
}

test('튜터 대화창: 내 말은 오른쪽, 튜터 말은 이름표와 왼쪽 — Enter 로 보내고 Shift+Enter 는 줄바꿈', async ({ context, page }) => {
  await local(context);
  const calls = [];
  await mockTutor(page, calls);
  await seedMission(page);
  await studentToCode(page);
  await openTutor(page);
  await page.locator('#tutor-q').type('첫 줄');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('둘째 줄');
  expect(calls.length).toBe(0);
  await expect(page.locator('#tutor-q')).toHaveValue('첫 줄\n둘째 줄');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tutor-msg.ai')).toHaveText(['답: 첫 줄\n둘째 줄?']);
  await expect(page.locator('#tutor-q')).toHaveValue('');
  await expect(page.locator('#tutor-live')).toHaveText('답: 첫 줄\n둘째 줄?');

  // 순서: 나 → 튜터. 튜터 쪽에만 보이는 이름표. 되묻기라도 꼬리표 없이 그냥 튜터의 말
  const rows = page.locator('#tutor-log .tutor-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveClass(/me/);
  await expect(rows.nth(1)).toHaveClass(/ai/);
  await expect(rows.nth(1).locator('.tutor-who')).toHaveText('튜터');
  await expect(page.locator('#tutor')).not.toContainText('되물었어요');
  const box = await page.locator('#tutor-log').boundingBox();
  const me = await page.locator('.tutor-msg.me').boundingBox();
  const ai = await page.locator('.tutor-msg.ai').boundingBox();
  expect(me.x + me.width).toBeGreaterThan(box.x + box.width - 40);   // 오른쪽에 붙는다
  expect(ai.x).toBeLessThan(box.x + 40);                               // 왼쪽에 붙는다
  expect(me.y).toBeLessThan(ai.y);
});

test('튜터 대화창: 기다리는 동안 답을 쓰는 중이라고 보인다', async ({ context, page }) => {
  await local(context);
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('**/api/tutor', async r => { await gate;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ kind: 'syntax', answer: '나눠요.', refused: false }) }); });
  await seedMission(page);
  await studentToCode(page);
  await openTutor(page);
  await page.locator('#tutor-q').fill('split?');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tutor-row.typing')).toHaveText(/답을 쓰는 중이에요/);
  await expect(page.locator('#tutor-send')).toBeDisabled();
  release();
  await expect(page.locator('.tutor-row.typing')).toHaveCount(0);
  await expect(page.locator('.tutor-msg.ai')).toHaveText(['나눠요.']);
});

test('튜터 대화창: 미션마다 대화가 따로고, 새로고침해도 다시 열린다', async ({ context, page }) => {
  await local(context);
  const calls = [];
  await mockTutor(page, calls);
  await seedTwoMissions(page);
  await toCode(page, 'ai-e2e');
  await openTutor(page);
  for (const q of ['A1', 'A2', 'A3', 'A4']) {
    await page.locator('#tutor-q').fill(q);
    await page.keyboard.press('Enter');
    await expect(page.locator('.tutor-msg.ai').last()).toHaveText('답: ' + q + '?');
  }
  await page.locator('#tutor-close').click();

  // B 미션 — A 의 말은 보이지 않고, 서버에 가는 이전 대화도 B 것만
  await toCode(page, 'ai-e2e-b');
  await openTutor(page);
  await expect(page.locator('#tutor-log .tutor-row')).toHaveCount(0);
  await page.locator('#tutor-q').fill('B1');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tutor-msg.ai')).toHaveText(['답: B1?']);
  expect(calls[calls.length - 1].history).toEqual([]);
  await page.locator('#tutor-close').click();

  // 새로고침 뒤 A 를 다시 열면 A 의 대화가 그대로, 서버에는 A 의 마지막 3턴
  await page.reload();
  await toCode(page, 'ai-e2e');
  await openTutor(page);
  await expect(page.locator('.tutor-msg.me')).toHaveText(['A1', 'A2', 'A3', 'A4']);
  await expect(page.locator('#tutor-log')).not.toContainText('B1');
  await page.locator('#tutor-q').fill('A5');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tutor-msg.ai').last()).toHaveText('답: A5?');
  expect(calls[calls.length - 1].history.map(h => h.q)).toEqual(['A2', 'A3', 'A4']);

  // 지난 대화 — 이야기한 미션 목록, 고르면 읽기만 하는 대화
  await page.locator('#tutor-past').click();
  await expect(page.locator('#tutor-form')).toBeHidden();
  await expect(page.locator('.tutor-past-item')).toHaveText(['시험용 미션', '둘째 미션']);
  await page.locator('.tutor-past-item', { hasText: '둘째 미션' }).click();
  await expect(page.locator('#tutor-title')).toHaveText('둘째 미션');
  await expect(page.locator('.tutor-msg.me')).toHaveText(['B1']);
  await expect(page.locator('#tutor-form')).toBeHidden();
  await page.locator('#tutor-back').click();
  await expect(page.locator('.tutor-past-item')).toHaveCount(2);
  await page.locator('#tutor-back').click();
  await expect(page.locator('#tutor-form')).toBeVisible();
  await expect(page.locator('.tutor-msg.me')).toHaveText(['A1', 'A2', 'A3', 'A4', 'A5']);
});

test('무한루프는 5초 뒤 멈추고 화면은 살아 있다', async ({ context, page }) => {
  test.setTimeout(180000);
  await local(context);
  await seedMission(page);
  await studentToCode(page);
  await waitPython(page);
  await page.locator('#code-editor').fill('data = "a"\nwhile True:\n    pass\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#run-code')).toBeDisabled();
  await page.locator('#back-method').click();                          // 그동안에도 화면은 반응한다
  await expect(page.locator('#step3')).toHaveClass(/active/);
  await page.locator('#reason-method').fill('이유 적기');
  await page.locator('#go-run').click();
  await expect(page.locator('#code-result')).toHaveText('5초 안에 끝나지 않아서 멈췄어요.', { timeout: 10000 });
  await expect(page.locator('#run-code')).toBeDisabled();              // 새 worker 준비 전
  await waitPython(page);
  await page.locator('#code-editor').fill('data = "a"\nprint(1)\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toHaveText('1', { timeout: 10000 });
  const evs = await page.evaluate(() => JSON.parse(localStorage.getItem('cutcheck.log.v1') || '[]'));
  expect(evs.some(e => e.type === 's-code' && e.error === '5초 안에 끝나지 않아서 멈췄어요.')).toBe(true);
});

test('input() 과 에러는 위치와 사실만', async ({ context, page }) => {
  test.setTimeout(120000);
  await local(context);
  await seedMission(page);
  await studentToCode(page);
  await waitPython(page);
  await page.locator('#code-editor').fill('data = "a"\nx = input()\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toContainText('input()을 쓸 수 없어요', { timeout: 10000 });
  await waitPython(page);
  await page.locator('#code-editor').fill('data = "a"\nparts = 1\nprint(pars)\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toHaveText(/^3번째 줄: NameError/, { timeout: 10000 });
  await waitPython(page);
  /* data 줄이 없어도 에디터 기준 줄 번호가 나온다 */
  await page.locator('#code-editor').fill('parts = 1\nprint(pars)\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toHaveText(/^2번째 줄: NameError/, { timeout: 10000 });
});

test('설계 카드가 코드 뼈대가 되고, 쓴 코드는 설계를 고쳐도 남는다', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await expect(page.locator('#samples .sample-data')).toHaveCount(2);           // 첫 화면에 자료 2개
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('이유 적기');
  await page.locator('#go-method').click();
  await expect(page.locator('.card-pick')).toHaveCount(4);                      // 진짜 3 + 헷갈리는 1
  await pickCards(page);
  await page.locator('.design-item').nth(2).locator('.card-up').click();        // 개수 세기를 위로
  await expect(page.locator('.design-item').nth(1)).toContainText('개수 세기');
  await page.locator('.design-item').nth(1).locator('.card-down').click();      // 되돌리기
  await page.locator('#reason-method').fill('이유 적기');
  await page.locator('#go-run').click();
  const code = await page.locator('#code-editor').inputValue();
  expect(code).toContain('# 1. 나누기 (기준: 쉼표)');
  expect(code).toContain('# 3. 개수 세기');
  expect(code).not.toMatch(/split|set\(|len\(/);                                // 함수 이름은 안 준다

  await page.locator('#code-editor').fill('data = "a,b"\nprint(1)\n');
  await page.locator('#back-method').click();
  await page.locator('.design-item').nth(2).locator('.card-remove').click();
  await page.locator('#reason-method').fill('이유 적기');
  await page.locator('#go-run').click();
  expect(await page.locator('#code-editor').inputValue()).toContain('print(1)'); // 덮어쓰지 않는다

  /* 설계↔코드를 오가도 Tab 리스너는 하나 — 한 번 눌러 공백 4칸 */
  await page.locator('#back-method').click();
  await page.locator('#reason-method').fill('이유 적기');
  await page.locator('#go-run').click();
  await page.locator('#code-editor').fill('');
  await page.locator('#code-editor').focus();
  await page.keyboard.press('Tab');
  expect(await page.locator('#code-editor').inputValue()).toBe('    ');
});

test('다른 미션으로 바꾸면 앞 미션 코드가 남지 않는다', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await studentToCode(page);
  await page.locator('#code-editor').fill('print("앞 미션")');
  await page.locator('.m-btn[data-id="sm2"]').click();
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('이유 적기');
  await page.locator('#go-method').click();
  await pickCards(page);
  await page.locator('#reason-method').fill('이유 적기');
  await page.locator('#go-run').click();
  expect(await page.locator('#code-editor').inputValue()).not.toContain('앞 미션');
});

/* 내 기록 — 미션마다 카드 하나, 코드 단계 결과로 (2026-10-17 학생 계정 검증에서 엉뚱한 값이 보였다).
 * 로컬 모드도 탭이 보여야 한다 — 숨기면 내 기록으로 가는 문이 없다 (2026-10-22) */
async function openHistory(page) {
  await page.locator('.main-tab[data-panel="panel-history"]').click();
}

test('로컬 모드 — 내 기록 탭이 보이고, 기록이 없으면 빈 안내가 보인다', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await expect(page.locator('.main-tab[data-panel="panel-history"]')).toBeVisible();
  await expect(page.locator('.main-tab[data-panel="panel-missions"]')).toBeHidden();   // 교실 폴더는 서버에만
  await openHistory(page);
  await expect(page.locator('#history-empty')).toHaveText('아직 기록이 없어요. 미션을 풀면 여기에 남아요.');
});

test('내 기록에는 미션마다 카드 하나, 코드 실행 결과와 내 판단이 남는다', async ({ page }) => {
  test.setTimeout(120000);
  await local(page.context());
  await seedMission(page);
  await studentToCode(page);
  await waitPython(page);
  await page.locator('#code-editor').fill('data = "a,b,a"\nprint(len(data.split(",")))\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toHaveText('3', { timeout: 10000 });
  await page.locator('#code-judge .judge-btn').first().click();
  await page.locator('#code-basis').fill('세 개가 나와서');
  await page.locator('#code-judge-save').click();
  await page.locator('#go-wrap').click();
  await expect(page.locator('#wrap-review')).toContainText('3');              // 정리 화면도 코드 실행 결과로
  await expect(page.locator('#wrap-review')).toContainText('세 개가 나와서');
  await page.locator('#wrap-text').fill('앞 미션 정리');
  await page.locator('#finish').click();

  await openHistory(page);
  const rec = page.locator('#history-list');
  await expect(rec).toContainText('시험용 미션');
  await expect(rec).toContainText('3');              // 코드 실행 결과
  await expect(rec).toContainText('세 개가 나와서'); // 내 판단의 근거
  await expect(rec).toContainText('앞 미션 정리');

  await page.locator('.main-tab[data-panel="panel-play"]').click();
  await page.locator('.m-btn[data-id="sm2"]').click();
  await page.locator('#go-define').click();
  await page.locator('.define-card').nth(1).click();
  await page.locator('#reason-define').fill('둘째 미션 이유');
  await page.locator('#go-method').click();
  await openHistory(page);
  const cards = rec.locator('.record-card');
  await expect(cards).toHaveCount(2);
  const other = cards.filter({ hasNotText: '시험용 미션' });
  await expect(other).toHaveCount(1);                       // 둘째 미션 카드가 따로 있다
  await expect(other).not.toContainText('앞 미션 정리');   // 다른 미션 기록이 섞이지 않는다
  await expect(other).not.toContainText('세 개가 나와서');
});

test('자료 3개로 실행 — 같은 코드를 자료마다 돌려 결과를 나란히 보인다', async ({ page }) => {
  test.setTimeout(120000);
  await local(page.context());
  await seedMission(page);
  await studentToCode(page);
  await waitPython(page);
  // sm1 복제: 주문서 01·02 는 3개, 03(반례)은 사과가 겹쳐 서로 다른 건 4개
  await page.locator('#code-editor').fill('data = "x"\nitems = data.split(",")\nprint(len(set(items)))\n');
  await page.locator('#run-all').click();
  const rows = page.locator('#code-table tbody tr');
  await expect(rows).toHaveCount(3, { timeout: 20000 });
  await expect(rows.nth(2).locator('.out')).toHaveText('4');
  await expect(rows.nth(0).locator('.out')).toHaveText('3');
  await expect(rows.nth(1).locator('.out')).toHaveText('3');
  await expect(rows.nth(2)).toContainText('새로 온 자료');
  await expect(page.locator('#code-judge')).toBeVisible();          // 판단은 학생이
  await expect(page.locator('#code-judge')).not.toContainText('정답'); // 시스템은 맞다·틀리다를 말하지 않는다

  await page.locator('#code-editor').fill('print(item)\n');            // 에러도 자료마다 위치와 사실만
  await page.locator('#run-all').click();
  await expect(rows.nth(2).locator('.out')).toContainText('1번째 줄', { timeout: 20000 });
});

test('성공 조건 화면은 받은 요청을 다시 보여 주고 묻는다', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await page.locator('#go-define').click();
  await expect(page.locator('#define-brief')).toHaveText('주문서에 상품이 몇 개인지 알려 주세요.');
  await expect(page.locator('#define-q')).toContainText('하나를 골라 주세요.');
});

/* 가짜 Supabase — 로그인한 학생, 교실 둘. js/data/supabase.js 를 이 객체로 바꿔 끼운다 */
const FAKE_SB = `(function(CC){var P=function(v){return Promise.resolve(v)};
var base={no:'AI',type:'sentence',pipelineId:'split-count',stage:'세기',brief:'재료가 모두 몇 개인지 알려 주세요.',define:{q:'어떤 결과가 나오면 성공일까요?',options:[{v:'재료가 모두 몇 개인지 나오면 성공',key:'count'}]},inputs:[{id:'d01',name:'월',v:'a,b'},{id:'d02',name:'화',v:'c,d'},{id:'d03',name:'수',v:'e',counter:true}]};
function m(id,t){var x=JSON.parse(JSON.stringify(base));x.id=id;x.title=t;return x}
CC.sb={active:function(){return true},getProfile:function(){return P({role:'student',name:'태인'})},
myClassrooms:function(){return P(window.__rooms||[{id:'r1',name:'1학년 3반'},{id:'r2',name:'방과후 코딩반'}])},
getMissions:function(rid){return P(rid==='r1'?[{id:'db1',data:m('ai-a','푼 미션')},{id:'db2',data:m('ai-b','하던 미션')},{id:'db3',data:m('ai-c','안 한 미션')}]:[])},
getMyEvents:function(){return P(window.__evs||[{type:'s-onboard',answers:[],skipped:true,_missionDbId:null},{type:'s-define',_missionDbId:'db1'},{type:'s-wrap',text:'끝',_missionDbId:'db1'},{type:'s-define',_missionDbId:'db2'}])},
pushEvent:function(rid,mid,ev){(window.__pushed=window.__pushed||[]).push([rid,mid]);(window.__evs=window.__evs||[]).push(ev);return P(null)},compassMine:function(){var c=window.__compass;return c==='throw'?Promise.reject(new Error('x')):P(c||null)},compassNote:function(id){window.__cn=(window.__cn||[]);window.__cn.push(id);var c=window.__note;return c==='throw'?Promise.reject(new Error('x')):P(c||null)},
signOut:function(){return P()},getUser:function(){return P({id:'u1'})},onAuthChange:function(){}}
})(window.CC=window.CC||{});`;

async function asStudent(page, rooms) {
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_SB }));
  if (rooms) await page.addInitScript(r => { window.__rooms = r; }, rooms);
  await page.goto(BASE + '/sentence.html');
}

test('학생 홈 — 교실은 폴더, 열면 미션 파일과 내 상태', async ({ page }) => {
  await asStudent(page);
  await expect(page.locator('.room-tile')).toHaveCount(2);
  await expect(page.locator('.room-tile').first()).toContainText('1학년 3반');
  await page.locator('.room-tile').first().click();
  await expect(page.locator('#room-view .crumb')).toContainText('1학년 3반');
  const files = page.locator('.mission-file');
  await expect(files).toHaveCount(3);
  await expect(files.nth(0)).toContainText('완료');
  await expect(files.nth(1)).toContainText('진행 중');
  await page.locator('#room-view .crumb a', { hasText: '내 교실' }).click();
  await expect(page.locator('.room-tile')).toHaveCount(2);
});

test('다른 교실을 둘러보고 돌아와도 기록은 미션을 연 교실로 간다', async ({ page }) => {
  await asStudent(page);
  await page.locator('.room-tile').first().click();                 // r1
  await page.locator('.mission-file').first().click();              // r1 의 db1
  await page.locator('#crumb-play-home').click();                    // 미션 머리의 '내 교실'
  await page.locator('.room-tile').nth(1).click();                  // r2 둘러보기
  await expect(page.locator('#room-title')).toHaveText('방과후 코딩반');
  await page.locator('.main-tab[data-panel="panel-play"]').click();
  await expect(page.locator('#crumb-play-room')).toHaveText('1학년 3반');
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('이유 적기');
  await page.locator('#go-method').click();
  const pushed = await page.evaluate(() => window.__pushed);
  expect(pushed).toEqual([['r1', 'db1']]);
});

test('폰 폭 04 — 튜터 막대가 결과 표를 덮지 않는다 (맨 아래까지 내려도)', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 });
  await local(page.context());
  await seedMission(page);
  await studentToCode(page);
  await expect(page.locator(TUTOR_ANY)).toHaveCount(1);
  // 막대는 화면 아래에 붙어 있고, 맨 아래까지 내려도 결과 표를 덮지 않는다
  await page.evaluate(() => window.scrollTo(0, 100000));
  const [barTop, stepBottom] = await page.evaluate(() => [
    document.querySelector('#tutor-open').getBoundingClientRect().top,
    document.querySelector('#step4').getBoundingClientRect().bottom]);
  expect(stepBottom).toBeLessThanOrEqual(barTop + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(420);
});

test('교실이 없는 학생 — 선생님께 말하라는 안내만, 스스로 들어가는 문은 없다', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await asStudent(page, []);
  await expect(page.locator('.room-empty')).toContainText('선생님께');
  await expect(page.locator('.room-join')).toHaveCount(0);
  await expect(page.locator('.room-tile')).toHaveCount(0);
  expect(errs).toEqual([]);
});

test('미션 머리 — 위치 표시, 큰 미션 이름, 단계 탭', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await expect(page.locator('#mission-title')).toHaveText('시험용 미션');
  await expect(page.locator('#steps-nav .current')).toContainText('01');
  await page.locator('#go-define').click();
  await expect(page.locator('#steps-nav .current')).toContainText('02');
});

test('설계도 줄은 위에서 아래로, 이름 옆에 ▲▼✕', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('이유 적기');
  await page.locator('#go-method').click();
  await pickCards(page);
  const rows = page.locator('.design-item');
  const y = await Promise.all([0, 1, 2].map(i => rows.nth(i).boundingBox().then(b => b.y)));
  expect(y[0] < y[1] && y[1] < y[2]).toBe(true);
  const w = await rows.first().boundingBox();
  expect(w.width).toBeLessThan(560);                 // 줄은 글자 폭만큼
});

/* 2026-10-20 "설계도 디자인이 좀 깨져" — 390 폭에서 긴 카드 이름이면 번호 · 이름 · ▲▼✕ 가
 * 저마다 다른 줄로 흩어졌고, 버튼은 26px 이었다. 한 줄은 같이 다니고, 넘치지 않고, 겹치지 않는다 */
test('설계도 — 390 폭 긴 카드 이름에서도 번호와 버튼이 이름과 같은 줄', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await local(page.context());
  const long = ['쉼표 뒤에 붙은 앞뒤 공백을 하나도 남기지 않고 모두 없애기', '같은 이름이 두 번 이상 나오면 한 번만 남기고 나머지는 지우기', '개수 세기'];
  await page.goto(BASE + '/sentence.html');
  await page.evaluate(long => {
    const m = JSON.parse(JSON.stringify(window.CC.SENTENCE_MISSIONS[0]));
    m.id = 'ai-e2e'; m.cards = long.map(label => ({ label }));
    localStorage.setItem('cutcheck.generated', JSON.stringify([m]));
    window.CC.store.clear();
  }, long);
  await page.reload();
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('이유 적기');
  await page.locator('#go-method').click();
  for (const l of long) await page.locator('.card-pick', { hasText: l }).click();
  const r = await page.evaluate(() => {
    const L = document.querySelector('#design-list');
    const rows = [...L.querySelectorAll('.design-item')].map(li => {
      const box = e => e.getBoundingClientRect();
      const num = box(li.querySelector('.num')), label = box(li.querySelector('.label')), btns = [...li.querySelectorAll('.moves button')].map(box);
      return { top: box(li).top, bottom: box(li).bottom,
        sameLine: btns.every(b => b.top < label.bottom && b.bottom > label.top) && num.top < label.bottom && num.bottom > label.top,
        smallest: Math.min.apply(null, btns.map(b => Math.min(b.width, b.height))) };
    });
    return { page: document.documentElement.scrollWidth - innerWidth, list: L.scrollWidth - L.clientWidth, rows };
  });
  expect(r.page).toBeLessThanOrEqual(0);
  expect(r.list).toBeLessThanOrEqual(0);
  r.rows.forEach((row, i) => {
    expect(row.sameLine).toBe(true);
    expect(row.smallest).toBeGreaterThanOrEqual(44);
    if (i) expect(row.top).toBeGreaterThanOrEqual(r.rows[i - 1].bottom);   // 줄끼리 겹치지 않는다
  });
});

/* 강사 — 교실은 폴더, 명단의 학생은 기록이 없어도 폴더, 교실에서 빼기 (2026-10-17 사람 요청) */
const FAKE_TEACHER = `(function(CC){var P=function(v){return Promise.resolve(v)};
var roster=[{id:'s1',name:'태인',login_id:'m9676u-1'},{id:'s2',name:'가은'},{id:'s3',name:'한결',login_id:'m9676u-2'}];
roster.forEach(function(r){if(window.__due===r.id)r.onboard_due='2026-10-19T00:00:00Z'});
window.__removed=[];window.__created=[];window.__reset=[];var T0=Date.now()-864e5;
CC.sb={active:function(){return true},
api:function(p,b){return fetch(p,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer fake'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){if(!r.ok){var e=new Error(j.error||'x');e.reasons=j.reasons;e.status=r.status;e.body=j;throw e}return j})})},
getUser:function(){return P({id:'t1'})},getProfile:function(){if(window.__noProfile)return P(null);return P({role:window.__role||'teacher',name:'김선생'})},
createStudent:function(rid,s){if(s.loginId==='taken')return Promise.reject(new Error('이미 있는 아이디예요.'));window.__created.push([rid,s]);roster.push({id:'n'+roster.length,name:s.name,login_id:s.loginId});return P({loginId:s.loginId,password:s.password||'k7mpq2xa'})},
resetStudentPassword:function(rid,lid){window.__reset.push([rid,lid]);return P({loginId:lid,password:'zz88aa44'})},
onAuthChange:function(){},signOut:function(){return P()},createClassroom:function(){return P({})},
myClassrooms:function(){return P([{id:'r1',name:'태인한결',code:'M9676U'},{id:'r2',name:'방과후',code:'AB12CD'}])},
getMissions:function(){return P(window.__missions||[])},saveMission:function(r,m){(window.__saved=window.__saved||[]).push([r,JSON.parse(JSON.stringify(m))]);return P({})},updateMission:function(id){(window.__updated=window.__updated||[]).push(id);return P({})},deleteMission:function(){return P({})},
getClassroomStudents:function(){return P(roster.filter(function(r){return window.__removed.indexOf(r.id)<0}))},
getClassroomEvents:function(){if(window.__evs)return P(window.__evs);if(window.__evHang)return new Promise(function(){});var X=window.__facts?[{type:'s-method',mid:'mx',cards:[{label:'더하기'},{label:'나누기'}],v:1,t:T0},{type:'s-code',mid:'mx',code:'print(3)',dataId:'[1, 2]',output:'3',error:'',v:1,t:T0},{type:'s-code',mid:'mx',code:'print(3)',dataId:'[]',output:'3',error:'',v:1,t:T0},{type:'s-probe',mid:'mx',sig:CC.codemission.sig('print(3)'),outs:[{dataId:'[1, 2]',output:'3',error:''},{dataId:'[]',output:'3',error:''}],uses:['For'],v:1,t:T0}].map(function(e){return {student_id:'s1',created_at:new Date(T0).toISOString(),profiles:{name:'태인'},event:e}}):[];return P(X.concat([{student_id:'s1',created_at:new Date(T0).toISOString(),profiles:{name:'태인'},event:{type:'s-define',choice:'몇 개',v:1,t:T0}},
{student_id:'s1',created_at:new Date(T0).toISOString(),profiles:{name:'태인'},event:{type:'s-onboard',answers:[],skipped:false,v:1,t:T0}}]))},
assignOnboard:function(rid,sid,on,set){(window.__assigned=window.__assigned||[]).push([rid,sid,on]);(window.__sets=window.__sets||[]).push(set);roster.forEach(function(r){if(r.id===sid){r.onboard_due=on?new Date(Date.now()+60000).toISOString():null;r.onboard_set=on?set:null}});return P(null)},
removeStudent:function(rid,sid){window.__removed.push(sid);return P({})},
alertChecks:function(rid){var s=sessionStorage;if(!s.__since)s.__since=String(window.__since||Date.now());return P({since:+s.__since,keys:JSON.parse(s['__ck'+rid]||'[]')})},
checkAlert:function(rid,k){var s=sessionStorage,a=JSON.parse(s['__ck'+rid]||'[]');if(a.indexOf(k)<0)a.push(k);s['__ck'+rid]=JSON.stringify(a);return P()},
compass:function(a,b){return CC.sb.api('/api/compass',Object.assign({action:a},b))}}
})(window.CC=window.CC||{});`;

test('강사 — 교실 폴더, 기록 없는 학생도 폴더, 교실에서 빼기', async ({ page }) => {
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_TEACHER }));
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/teacher.html');
  await expect(page.locator('#classroom-cards .room-tile')).toHaveCount(2);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  const tiles = page.locator('.student-tile');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.filter({ hasText: '가은' })).toContainText('아직 기록이 없어요');
  await expect(tiles.filter({ hasText: '가은' }).locator('.folder')).toHaveClass(/gray/);
  await tiles.filter({ hasText: '가은' }).click();   // 기록이 없어도 서랍은 열리고 빈 줄 안내가 보인다
  await expect(page.locator('#detail .d-main .emptyrow')).toHaveText('아직 기록이 없어요.');
  await expect(page.locator('#detail details.k-fold')).toHaveCount(0);
  await expect(page.locator('#detail .k-summary')).toContainText('표시할 것이 아직 없어요.');
  await expect(page.locator('#detail .k-summary .k-chip')).toHaveCount(0);
  expect(errs).toEqual([]);
  await page.locator('#detail-back').click();

  page.once('dialog', d => d.accept());
  await tiles.filter({ hasText: '한결' }).click();
  await page.locator('#detail .roster-remove').click();
  await expect(tiles).toHaveCount(2);
  expect(await page.evaluate(() => window.__removed)).toEqual(['s3']);

  page.once('dialog', d => d.dismiss());                    // 취소하면 아무것도 안 바뀐다
  await page.locator('.main-tab[data-dtab="dtab-invite"]').click();
  await page.locator('.roster-row', { hasText: '가은' }).locator('.roster-remove').click();
  expect(await page.evaluate(() => window.__removed)).toEqual(['s3']);
});

/* 2026-10-19 선생님 피드백 — "학생 정보 화면이 읽기 불편하다 · 비는 화면이 많다".
 * 넓은 화면에서 서랍은 넓게(1200px 넘게) 쓰되 옆으로 넘치지 않고, 먼저 물어볼 것이 기록보다 위에 있다 */
test('강사 — 1440 폭에서 학생 서랍은 넓고 옆으로 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const d = page.locator('#detail');
  await expect(d).toBeVisible();
  const box = await d.boundingBox();
  expect(box.width).toBeGreaterThan(700);                    // 본문 자리 — 서랍 폭이 아니다
  const o = await d.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, page: document.documentElement.scrollWidth - innerWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw);
  expect(o.page).toBeLessThanOrEqual(0);
  const ask = await d.locator('.k-note').boundingBox();
  const rows = await d.locator('.d-rows').boundingBox();
  expect(ask.y).toBeLessThan(rows.y);
  await expect(d.locator('.d-step-h')).toHaveText(['02 성공']);   // 기록은 학생 화면 단계 이름으로 묶인다
  const tut = await d.locator('.d-tutor').boundingBox();
  expect(tut.y).toBeGreaterThan(rows.y + rows.height - 1);   // 튜터 대화는 기록 아래 칸
  expect(rows.width).toBeLessThanOrEqual(760);
});

async function asTeacher(page, role) {
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_TEACHER }));
  if (role) await page.addInitScript(r => { window.__role = r; }, role);
  await page.goto(BASE + '/teacher.html');
}

test('강사 — 학생 계정을 만들면 아이디·비밀번호를 한 번 보여 주고 명단에 더한다', async ({ page }) => {
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-invite"]').click();
  await expect(page.locator('#ns-login')).toHaveValue('m9676u-3');        // 교실 코드 + 다음 번호
  await page.locator('#ns-name').fill('나래');
  await page.locator('#ns-login').fill('taken');
  await page.locator('#ns-go').click();
  await expect(page.locator('#ns-msg')).toHaveText('이미 있는 아이디예요.');
  await page.locator('#ns-login').fill('m9676u-3');
  await page.locator('#ns-go').click();
  await expect(page.locator('#ns-result .cred')).toContainText('m9676u-3');
  await expect(page.locator('#ns-result .cred')).toContainText('k7mpq2xa');
  await expect(page.locator('.roster-row', { hasText: '나래' })).toBeVisible();
  await expect(page.locator('#ns-login')).toHaveValue('m9676u-4');
  expect(await page.evaluate(() => window.__created)).toEqual([['r1', { name: '나래', loginId: 'm9676u-3', password: '' }]]);

  page.once('dialog', d => d.accept());
  const row = page.locator('.roster-row', { hasText: '태인' });
  await row.locator('.roster-reset').click();
  await expect(page.locator('#ns-result .cred')).toContainText('zz88aa44');
  await expect(page.locator('.roster-row', { hasText: '가은' }).locator('.roster-reset')).toHaveCount(0);   // 아이디 없는 예전 계정
});

/* 레벨 테스트 대상 지정 — 명단 줄에 상/중/하 또는 대기 (2026-10-19 사람 요청) */
test('강사 — 명단에 레벨이 보이고, 대상자로 지정·풀기', async ({ page }) => {
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-invite"]').click();
  const 태인 = page.locator('.roster-row', { hasText: '태인' });
  const 가은 = page.locator('.roster-row', { hasText: '가은' });
  await expect(태인.locator('.roster-level')).toHaveText('레벨 하');          // 다 비운 답 → 하
  await expect(가은.locator('.roster-level')).toHaveText('레벨 테스트 안 함');
  await 가은.locator('.roster-test').click();
  await expect(가은.locator('.roster-level')).toHaveText('레벨 테스트 대기');
  await expect(가은.locator('.roster-test')).toHaveText('레벨 테스트 지정 풀기');
  await 가은.locator('.roster-test').click();
  await expect(가은.locator('.roster-level')).toHaveText('레벨 테스트 안 함');
  expect(await page.evaluate(() => window.__assigned)).toEqual([['r1', 's2', true], ['r1', 's2', false]]);
  await page.locator('.main-tab[data-dtab="dtab-students"]').click();
  await page.locator('.student-tile', { hasText: '태인' }).click();
  await expect(page.locator('#detail .dsub')).toContainText('레벨 하');
});

test('강사 — 문제지를 골라 지정하고, 서랍에 레벨 테스트 기록이 남는다', async ({ page }) => {
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-invite"]').click();
  const 가은 = page.locator('.roster-row', { hasText: '가은' });
  await expect(가은.locator('.roster-set')).toHaveValue('mid');                   // 기본은 중
  const h = await 가은.locator('.roster-set').boundingBox();
  expect(h.height).toBeGreaterThanOrEqual(44);
  await 가은.locator('.roster-set').selectOption('high');
  await 가은.locator('.roster-test').click();
  await expect(가은.locator('.roster-level')).toHaveText('레벨 테스트 대기');
  expect(await page.evaluate(() => window.__sets)).toEqual(['high']);
  await page.locator('.main-tab[data-dtab="dtab-students"]').click();
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const rec = page.locator('#detail .lv-rec');
  await expect(rec).toHaveCount(1);
  await expect(rec).toContainText('문제지 중');                                  // set 없던 기록은 중
  await expect(rec.locator('.lv-n')).toHaveText('0/10');
  await expect(rec.locator('.lv-ox')).toHaveText('××××××××××');
  await expect(rec.locator('.lv-stage')).toHaveText('레벨 하');
});

test('강사 — 마지막 테스트 두 달 뒤 재테스트 알림, 학생당 한 번, 지정하면 사라진다', async ({ page }) => {
  const now = Date.now();                                                         // 새로고침해도 같은 기록 — 시각을 한 번만 정한다
  await page.addInitScript(now => {
    const row = (sid, name, ev) => ({ student_id: sid, created_at: new Date().toISOString(), profiles: { name }, event: Object.assign({ v: 1 }, ev) });
    window.__evs = [row('s1', '태인', { type: 's-onboard', answers: [], skipped: false, set: 'low', t: now - 61 * 864e5 }),
      row('s3', '한결', { type: 's-onboard', answers: [], skipped: false, t: now - 59 * 864e5 })];
  }, now);
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  const al = page.locator('#alert-list li[data-kind="retest"]');
  await expect(al).toHaveCount(1);
  await expect(al).toContainText('태인의 레벨 테스트가 두 달 지났어요. 다시 지정할까요?');
  await expect(al.locator('.al-tag')).toHaveText('레벨 테스트');
  await page.waitForTimeout(5500);                                               // 다음 기록 읽기 뒤에도 한 번
  await expect(al).toHaveCount(1);
  await page.locator('.main-tab[data-dtab="dtab-invite"]').click();
  await page.locator('.roster-row', { hasText: '태인' }).locator('.roster-test').click();
  await expect(al).toHaveCount(0);
  await page.reload();                                                           // 가짜 명단은 지정을 잊는다 — 확인 전이라 다시 뜬다
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await expect(al).toHaveCount(1);
  await al.locator('.al-ok').click();
  await expect(al).toHaveCount(0);
  await page.reload();                                                           // 확인했으면 다시 열어도 없다
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await page.waitForTimeout(500);
  await expect(al).toHaveCount(0);
});

test('강사 — 명단을 다시 그려도 입력한 아이디와 새 비밀번호는 남는다', async ({ page }) => {
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-invite"]').click();
  await page.locator('#ns-login').fill('m9676u-qa94113');
  page.once('dialog', d => d.accept());
  await page.locator('.roster-row', { hasText: '가은' }).locator('.roster-remove').click();   // 명단 다시 그리기
  await expect(page.locator('.roster-row')).toHaveCount(2);
  await expect(page.locator('#ns-login')).toHaveValue('m9676u-qa94113');

  page.once('dialog', d => d.accept());
  await page.locator('.roster-row', { hasText: '태인' }).locator('.roster-reset').click();
  await expect(page.locator('#ns-result .cred')).toContainText('zz88aa44');
  page.once('dialog', d => d.accept());
  await page.locator('.roster-row', { hasText: '한결' }).locator('.roster-remove').click();   // 다시 그리기
  await expect(page.locator('.roster-row')).toHaveCount(1);
  await expect(page.locator('#ns-result .cred')).toContainText('zz88aa44');
  await expect(page.locator('#ns-result .cred-note')).toContainText('태인');
});

test('학생 프로필로 선생님 화면을 열면 학생 화면으로 간다', async ({ page }) => {
  await asTeacher(page, 'student');
  await expect(page).toHaveURL(/sentence\.html/);
});

test('로그인 화면 — 역할 고르기도 교실 코드 입력도 없다, 아이디로도 들어온다', async ({ page }) => {
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.goto(BASE + '/auth.html');
  await expect(page.locator('#signup-role')).toHaveCount(0);
  await expect(page.locator('#join-section')).toHaveCount(0);
  await expect(page.locator('#join-code')).toHaveCount(0);
  await expect(page.locator('#tab-signup')).toHaveText('강사 가입');
  await expect(page.locator('label[for="login-email"]')).toHaveText('이메일 또는 아이디');
  expect(await page.evaluate(() => [CC.sb.loginEmail('Kim-1'), CC.sb.loginEmail('t@school.kr')]))
    .toEqual(['kim-1@students.invalid', 't@school.kr']);
});

test('04 는 설계|코드 두 단이고, 지난 단계 탭으로 돌아갈 수 있다', async ({ context, page }) => {
  await local(context);
  await seedMission(page);
  await studentToCode(page);
  const brief = await page.evaluate(() => window.CC.SENTENCE_MISSIONS[0].brief);
  await expect(page.locator('#step4-brief')).toContainText(brief);
  await expect(page.locator('#design-side li')).toHaveText([/나누기/, /겹친 것은 하나만/, /개수 세기/]);
  await page.locator('#steps-nav button[data-step="2"]').click();
  await expect(page.locator('#step2')).toHaveClass(/active/);
  await expect(page.locator('#steps-nav button[data-step="5"]')).toBeDisabled();
});

test('폰 폭에서는 04 설계가 코드 위에 쌓인다', async ({ context, page }) => {
  await local(context);
  await page.setViewportSize({ width: 420, height: 900 });
  await seedMission(page);
  await studentToCode(page);
  const side = await page.locator('#design-side').boundingBox();
  const code = await page.locator('#code-editor').boundingBox();
  expect(side.y).toBeLessThan(code.y);
});

test('교실 첫 입장 — 레벨 테스트 10문항, 맞고 틀림은 보이지 않고 끝나면 미션이 열린다', async ({ page }) => {
  await page.addInitScript(() => { window.__evs = []; });            // 이 교실에 진단 기록이 없다
  await asStudent(page);
  await page.locator('.room-tile').first().click();
  const ob = page.locator('#onboard-view');
  await expect(ob).toBeVisible();
  await expect(page.locator('#room-view')).toBeHidden();             // 미션 목록은 진단이 끝난 뒤에
  await expect(page.locator('#ob-skip')).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await expect(page.locator('#ob-count')).toHaveText((i + 1) + ' / 10');
    await expect(page.locator('#ob-options button').last()).toHaveText('모르겠어요');
    if (i === 1) {                                                   // 이전으로 돌아가도 된다
      await page.locator('#ob-prev').click();
      await expect(page.locator('#ob-count')).toHaveText('1 / 10');
      await expect(page.locator('#ob-options .btn.primary')).toHaveCount(1);   // 내가 고른 것이 남아 있다
      await page.locator('#ob-options button').first().click();
    }
    if (await page.locator('#ob-input').count()) {                   // 단답형 — 비우면 다음으로 못 간다
      await expect(page.locator('#ob-options button', { hasText: '다음' })).toBeDisabled();
      await page.locator('#ob-input').fill('나');
      await page.locator('#ob-input').press('Enter');
    } else await page.locator('#ob-options button').first().click();
  }
  await expect(page.locator('#ob-done')).toHaveText('고마워요. 이제 미션을 볼 수 있어요.');
  await expect(ob).not.toContainText(/맞았|틀렸|정답|오답|레벨|상위|하위/);
  await page.locator('#ob-done').click();
  await expect(ob).toBeHidden();
  await expect(page.locator('.mission-file')).toHaveCount(3);
  const evs = await page.evaluate(() => window.__evs);
  expect(evs.length).toBe(1);
  expect(evs[0].type).toBe('s-onboard');
  expect(evs[0].skipped).toBe(false);
  expect(evs[0].answers.map(a => a.q)).toEqual(['d1', 'd2', 'd11', 'd4', 'd5', 'd12', 'd13', 'd8', 'd14', 'd15']);
  expect(evs[0].answers[1].pick).toBe('나');                        // 단답형은 쓴 글자 그대로
  expect(await page.evaluate(() => window.__pushed)).toEqual([['r1', null]]);
  // 다시 열면 진단은 없다. 큰 교실 이름이 '내 교실' 링크를 덮어 마우스 클릭이 h1 에 떨어진다 (기존 배치 문제) — 이벤트로 누른다
  await page.locator('#crumb-home').dispatchEvent('click');
  await page.locator('.room-tile').first().click();
  await expect(page.locator('.mission-file')).toHaveCount(3);
  await expect(ob).toBeHidden();
});

test('선생님이 대상자로 정하면 로그인하자마자 테스트가 뜨고 건너뛸 수 없다', async ({ page }) => {
  // 예전에 건너뛴 기록(_at)은 지정 시각보다 앞선다
  await page.addInitScript(() => { window.__evs = [{ type: 's-onboard', answers: [], skipped: true, _at: '2026-10-01T00:00:00Z' }]; });
  await asStudent(page, [{ id: 'r1', name: '1학년 3반' }, { id: 'r2', name: '방과후 코딩반', onboard_due: '2026-10-19T00:00:00Z' }]);
  await expect(page.locator('#onboard-view')).toBeVisible();          // 교실을 누르지 않아도
  await expect(page.locator('#room-title')).toHaveText('방과후 코딩반');
  await expect(page.locator('#ob-skip')).toBeHidden();
});

/* 2026-10-20 사람이 정함 — 문제지 하·중·상, 기록은 남고, 학생은 난이도도 점수도 못 본다 */
test('지정한 문제지(상)로 출제되고, 화면에 난이도가 없고, 기록에는 문제지와 답만', async ({ page }) => {
  await page.addInitScript(() => { window.__evs = []; });
  await asStudent(page, [{ id: 'r1', name: '1학년 3반', onboard_due: '2026-10-19T00:00:00Z', onboard_set: 'high' }]);
  const ob = page.locator('#onboard-view');
  await expect(ob).toBeVisible();
  await expect(page.locator('#ob-code')).toContainText('짜장');              // 상 문제지 첫 문항
  for (let i = 0; i < 10; i++) {
    await expect(ob).not.toContainText(/문제지|난이도|레벨|맞았|틀렸|정답/);
    if (await page.locator('#ob-input').count()) { await page.locator('#ob-input').fill('1'); await page.locator('#ob-input').press('Enter'); }
    else await page.locator('#ob-options button').first().click();
  }
  await expect(ob).not.toContainText(/문제지|난이도|레벨|점수|\/10/);
  await page.locator('#ob-done').click();
  const evs = await page.evaluate(() => window.__evs);
  expect(evs[0].set).toBe('high');
  expect(evs[0].answers.map(a => a.q)).toEqual(['h1', 'h2', 'h3', 'h11', 'h5', 'h6', 'h12', 'h8', 'h13', 'h14']);
  expect(Object.keys(evs[0]).sort()).toEqual(['answers', 'set', 'skipped', 't', 'type', 'v']);   // 점수·레벨 칸 없음
});

test('지정 없는 첫 입장은 중 문제지', async ({ page }) => {
  await page.addInitScript(() => { window.__evs = []; });
  await asStudent(page, [{ id: 'r1', name: '1학년 3반', onboard_set: 'low' }]);   // 지정(due) 없이 남은 문제지는 쓰지 않는다
  await page.locator('.room-tile').first().click();
  await page.locator('#ob-skip').click();
  expect((await page.evaluate(() => window.__evs))[0].set).toBe('mid');
});

test('지정 뒤 이미 테스트를 봤으면 다시 뜨지 않는다', async ({ page }) => {
  await page.addInitScript(() => { window.__evs = [{ type: 's-onboard', answers: [], skipped: false, _at: '2026-10-19T01:00:00Z' }]; });
  await asStudent(page, [{ id: 'r1', name: '1학년 3반', onboard_due: '2026-10-19T00:00:00Z' }]);
  await expect(page.locator('.room-tile')).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#onboard-view')).toBeHidden();
  await expect(page.locator('#rooms-view')).toBeVisible();
});

test('진단은 건너뛸 수 있다', async ({ page }) => {
  await page.addInitScript(() => { window.__evs = []; });
  await asStudent(page);
  await page.locator('.room-tile').first().click();
  await page.locator('#ob-skip').click();
  await expect(page.locator('#onboard-view')).toBeHidden();
  await expect(page.locator('.mission-file')).toHaveCount(3);
  const evs = await page.evaluate(() => window.__evs);
  expect(evs.map(e => [e.type, e.skipped, e.answers.length])).toEqual([['s-onboard', true, 0]]);
});

test('로컬 모드 — 진단은 뜨지 않고 미션이 바로 열린다', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await expect(page.locator('#onboard-view')).toBeHidden();
  await expect(page.locator('.m-btn[data-id="ai-e2e"]')).toBeVisible();
});

/* 골라내기 기준 목록은 숨은 설정이 아니라 자료다 — "민지 시간 vs 준호 시간" 이 학생 눈에 보여야 한다 (2026-10-18) */
test('골라내기 고정 목록이 01 문제·03 카드·04 요청에 보인다', async ({ page }) => {
  await local(page.context());
  await page.goto(BASE + '/sentence.html');
  await page.evaluate(() => {
    const m = JSON.parse(JSON.stringify(window.CC.sentenceMission('sm-filter-1')));
    m.id = 'ai-e2e'; m.no = 'AI'; m.title = '시험용 미션';
    localStorage.setItem('cutcheck.generated', JSON.stringify([m]));
    window.CC.store.clear();
  });
  await page.reload();
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await expect(page.locator('#samples')).toContainText('주의 재료 목록');
  await expect(page.locator('#samples .sample-fixed')).toHaveText('우유,달걀,땅콩');
  await expect(page.locator('#samples .sample-data')).toHaveCount(2);           // 반례는 여전히 숨는다
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('이유 적기');
  await page.locator('#go-method').click();
  await page.locator('.card-pick', { hasText: '골라내기' }).click();
  await expect(page.locator('.design-item .card-list')).toHaveText('우유,달걀,땅콩');
  await page.locator('.card-pick', { hasText: '나누기' }).click();
  await page.locator('.card-pick', { hasText: '개수 세기' }).click();
  for (const s of await page.locator('.design-item select').all()) await s.selectOption({ index: 1 });
  await page.locator('#reason-method').fill('이유 적기');
  await page.locator('#go-run').click();
  await expect(page.locator('#step4-fixed')).toHaveText('주의 재료 목록: 우유,달걀,땅콩');
});

test('고정 목록이 없는 미션에는 목록 칸이 없다', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await expect(page.locator('#samples .sample-fixed')).toHaveCount(0);
});

test('교사 초안에 고정 목록이 보이고 고칠 수 있다', async ({ context, page }) => {
  await local(context);
  const fixture = require('./fixtures/mission.json');
  const draft = { ...fixture, pipelineId: 'split-filter-join', filterDesc: '민지 시간',
    pipelineParams: { filterTarget: ['3시', '4시', '5시'] }, guard: { fallback: [], reasons: {} },
    inputs: [{ id: 'd01', name: '준호 쪽지', v: '4시,5시,6시' }, { id: 'd02', name: '서연 쪽지', v: '2시,3시' },
             { id: 'd03', name: '하린 쪽지', v: '6시 7시', counter: true, axis: 'sep' }] };
  delete draft.method;
  await page.route('**/api/generate-mission', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(draft) }));
  await page.goto(BASE + '/teacher.html');
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#gt-quick').click();
  await page.locator('#gen-lesson').fill('집합');
  await page.locator('#gen-key').fill('모두 되는 시간');
  await page.locator('#gen-btn').click();
  await expect(page.locator('#draft-fixed')).toHaveValue('3시,4시,5시');
  await expect(page.locator('#draft-fixed-name')).toHaveValue('민지 시간');
  await expect(page.locator('#gen-result')).toContainText('처음 고정 목록과 첫 자료로 계산했어요');
  /* 목록이 한 자료 안에 통째로 있으면 그 자료의 답이 목록 그대로 — 저장을 막는다 */
  await page.locator('#draft-fixed').fill('4시,5시');
  await page.locator('#confirm-mission').click();
  await expect(page.locator('#draft-fixed-warn')).toContainText('준호 쪽지 안에 통째로');
  await page.locator('#draft-fixed').fill('8시,9시');
  await page.locator('#confirm-mission').click();
  await expect(page.locator('#draft-fixed-warn')).toContainText('하나도 겹치지 않아요');
  expect(await page.evaluate(() => localStorage.getItem('cutcheck.generated'))).toBeNull();
  await page.locator('#draft-fixed').fill('3시, 4시');
  await page.locator('#confirm-mission').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cutcheck.generated')).pop());
  expect(saved.pipelineParams.filterTarget).toEqual(['3시', '4시']);
});

/* 새 꼴(kind:'code') 미션은 자료가 파이썬 리터럴이다. 손으로 만들어 같은 경로(cutcheck.generated)로 넣는다 */
async function seedCodeMission(page, m) {
  await page.goto(BASE + '/sentence.html');
  await page.evaluate((mm) => {
    localStorage.setItem('cutcheck.generated', JSON.stringify([mm]));
    window.CC.store.clear();
  }, m);
  await page.reload();
}

test('새 꼴 미션 — 리터럴 자료로 돌고 반례로 바꾸면 반례로 돈다', async ({ context, page }) => {
  test.setTimeout(120000);
  await local(context);
  await seedCodeMission(page, {
    id: 'ai-code', no: 'AI', type: 'sentence', kind: 'code', concept: 'for', stage: '분해',
    title: '영수증을 합쳐요', brief: '영수증 금액이 모두 얼마인지 알려 주세요.',
    define: { q: '어떤 결과가 나오면 성공일까요?', options: [
      { v: '영수증 금액을 모두 합친 값', key: 'a' },
      { v: '영수증 1의 답과 같은 2300이 나오면 성공', key: 'b', trap: 'hardcode' },
      { v: '오류 없이 끝나면 성공', key: 'c', trap: 'luck' }] },
    inputs: [{ id: 'd01', name: '영수증 1', v: '[1500, 800]' }, { id: 'd02', name: '영수증 2', v: '[300]' },
      { id: 'd03', name: '새 영수증', v: '[]', counter: true, axis: 'empty' }],
    cards: [{ label: '하나씩 꺼내기' }, { label: '모두 더하기' }, { label: '가장 큰 값 찾기', decoy: true }]
  });
  await page.locator('.m-btn[data-id="ai-code"]').click();
  await page.locator('#go-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#reason-define').fill('모두 합해야 하니까');
  await page.locator('#go-method').click();
  await expect(page.locator('.card-pick')).toHaveCount(3);
  await page.locator('.card-pick', { hasText: '모두 더하기' }).click();
  await page.locator('#reason-method').fill('보이는 대로');
  await page.locator('#go-run').click();
  await expect(page.locator('#step4')).toHaveClass(/active/);
  expect((await page.locator('#code-editor').inputValue()).split('\n')[0]).toBe('data = [1500, 800]');
  await waitPython(page);
  await page.locator('#code-editor').fill('data = [1500, 800]\nprint(sum(data))\n');
  await page.locator('#code-data-select').selectOption({ label: '새 영수증' });
  expect((await page.locator('#code-editor').inputValue()).split('\n')[0]).toBe('data = []');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toHaveText('0', { timeout: 10000 });
});

test('예전 미션 — 쉼표 자료는 그대로 따옴표로 돈다', async ({ context, page }) => {
  await local(context);
  await seedMission(page);
  await studentToCode(page);
  expect((await page.locator('#code-editor').inputValue()).split('\n')[0]).toBe('data = "사과,바나나,우유"');
});

test('실행기 — 앞 실행이 도는 동안 부른 실행도 차례로 끝난다', async ({ context, page }) => {
  test.setTimeout(60000);
  await local(context);
  await page.goto(BASE + '/sentence.html');
  const r = await page.evaluate(() => new Promise(resolve => {
    let up; const ready = new Promise(r => { up = r; });
    const py = window.CC.pyrun.create((t, ok) => { if (ok) up(); });
    const got = [];
    const done = (k) => (o, e) => { got.push([k, o, e]); if (got.length === 4) resolve({ got, TIMEOUT: window.CC.pyerr.TIMEOUT }); };
    ready.then(() => {
      py.run('print(1)', done('a'));
      py.run('print(2)', done('b'));
      py.run('while True: pass', done('c'));
      py.run('print(3)', done('d'));
    });
  }));
  expect(r.got).toEqual([['a', '1\n', ''], ['b', '2\n', ''], ['c', '', r.TIMEOUT], ['d', '3\n', '']]);
});

/* 서버가 로그인한 강사만 받는다 — 강사 모드의 빠른 생성은 CC.sb.api(토큰을 붙이는 data 층 함수)로 간다 */
test('강사 모드 — 빠른 생성은 CC.sb.api 로 부른다', async ({ page }) => {
  await asTeacher(page);
  const fixture = require('./fixtures/mission.json');
  await page.route('**/api/generate-mission', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ...fixture, guard: { fallback: [], reasons: {} } }) }));
  await page.evaluate(() => { const f = CC.sb.api; window.__api = []; CC.sb.api = (p, b) => { window.__api.push(p); return f(p, b); }; });
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#gt-quick').click();
  await page.locator('#gen-lesson').fill('리스트와 반복문');
  await page.locator('#gen-key').fill('같은 값이 여러 번 나올 때');
  await page.locator('#gen-btn').click();
  await expect(page.locator('#confirm-mission')).toBeVisible();
  expect(await page.evaluate(() => window.__api)).toEqual(['/api/generate-mission']);
});

/* 단계별 생성 1·2단계 — 개념을 확인하고 예시를 고른다 (서버는 가짜 응답) */
test('강사 단계별 생성 — 개념을 확인하고 예시를 고른다', async ({ page }) => {
  const reqs = [], auth = [];
  let n = 0;
  await page.route('**/api/mission-steps', async r => {
    const b = r.request().postDataJSON();
    reqs.push(b);
    auth.push(r.request().headers()['authorization']);
    if (b.action === 'quota') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ left: 3, disabled: false }) });
    if (b.action === 'concept') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ concept: 'for', label: '반복문 for', by: 'keyword' }) });
    const k = n++ ? 'b' : 'a';
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ examples: [1, 2, 3, 4].map(i => ({ title: `${k}제목${i}`, situation: `${k}상황${i}이에요.`, why: `${k}이유${i}` })) }) });
  });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#gen-lesson').fill('리스트와 반복문');
  await page.locator('#gen-key').fill('하나씩 꺼내 보기');
  await page.locator('#sg-concept').click();
  await expect(page.locator('#sg-concept-pick')).toHaveValue('for');
  await expect(page.locator('#sg-concept-pick option')).toHaveCount(8);
  await page.locator('#sg-next').click();
  await expect(page.locator('.sg-ex')).toHaveCount(4);
  await expect(page.locator('.sg-ex').first().locator('span')).toHaveText(['a제목1', 'a상황1이에요.', '→ a이유1']);
  await expect(page.locator('#sg-build')).toBeDisabled();
  await page.locator('#sg-more').click();
  await expect(page.locator('.sg-ex').first()).toContainText('b제목1');
  const more = reqs.filter(b => b.action === 'examples').pop();
  expect(more.seen).toEqual(['a제목1', 'a제목2', 'a제목3', 'a제목4']);
  expect(more.concept).toBe('for');
  expect(auth.every(Boolean)).toBe(true);
  await page.locator('.sg-ex').nth(1).click();
  await expect(page.locator('.sg-ex').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sg-build')).toBeEnabled();
  await page.locator('.gp-s[data-step="2"] .gp-fix').click();
  await page.locator('#sg-concept-pick').selectOption('while');
  await expect(page.locator('#sg-build')).toBeDisabled();            // 개념을 바꾸면 예시를 새로 받고 고름은 비운다
  expect(reqs.filter(b => b.action === 'examples').pop().concept).toBe('while');
});

test('강사 단계별 생성 — 개념을 빨리 바꾸면 늦게 온 옛 응답은 버린다', async ({ page }) => {
  await page.route('**/api/mission-steps', async r => {
    const b = r.request().postDataJSON();
    if (b.action === 'concept') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ concept: 'for', label: '반복문 for', by: 'keyword' }) });
    if (b.concept === 'while') await new Promise(f => setTimeout(f, 600));   // 먼저 보낸 요청이 늦게 도착한다
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ examples: [{ title: b.concept + '-예시', situation: '상황이에요.', why: '이유' }] }) });
  });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#gen-lesson').fill('반복문');
  await page.locator('#sg-concept').click();
  await expect(page.locator('.sg-ex')).toContainText('for-예시');
  await page.locator('#sg-next').click();
  await page.locator('.sg-ex').click();
  await expect(page.locator('#sg-build')).toBeEnabled();
  await page.locator('.gp-s[data-step="2"] .gp-fix').click();
  await page.locator('#sg-concept-pick').selectOption('while');   // 느린 응답
  await expect(page.locator('#sg-build')).toBeDisabled();          // 요청 중에 옛 고름이 남지 않는다
  await page.locator('#sg-concept-pick').selectOption('if');
  await expect(page.locator('.sg-ex')).toContainText('if-예시');
  await page.waitForTimeout(900);
  await expect(page.locator('.sg-ex')).toHaveCount(1);
  await expect(page.locator('.sg-ex')).toContainText('if-예시');
  await expect(page.locator('#sg-build')).toBeDisabled();
});

/* 단계별 생성 3·4단계 — 가짜 build 가 주는 초안을 강사 브라우저의 Pyodide 로 돌려 정답을 얻는다 */
const SG_DRAFT = (solution) => ({ draft: {
  kind: 'code', concept: 'for', title: '영수증 합치기', situation: '민서가 영수증을 모았어요. 모두 얼마인지 알아야 해요.',
  brief: '영수증 금액이 모두 얼마인지 알려 주세요.',
  inputs: [{ id: 'd01', name: '영수증 1', v: '[1500, 800]' }, { id: 'd02', name: '영수증 2', v: '[300]' },
    { id: 'd03', name: '새 영수증', v: '[]', counter: true, axis: 'empty' }],
  cards: [{ label: '하나씩 꺼내기', decoy: false }, { label: '모두 더하기', decoy: false }, { label: '가장 큰 값 찾기', decoy: true }],
  define: { q: '어떤 결과가 나오면 성공일까요?', options: [{ v: '모든 금액을 더한 값이 나오면 성공', trap: null }, { v: '오류 없이 끝나면 성공', trap: 'luck' }] },
  solution } });

const SPENT = '생성 횟수를 다 썼어요. 관리자에게 문의해 주세요.';

/* for 미션의 모범 답안은 for 를 써야 검사를 통과한다 — print(sum(data)) 는 '개념이 안 쓰였다'로 걸린다 */
const SG_FOR = 't = 0\nfor x in data:\n    t += x\nprint(t)';

async function sgBuild(page, solutions, solveCode, before, quota = { left: 3, disabled: false }) {
  const builds = [], solves = [];
  await page.route('**/api/mission-steps', async r => {
    const b = r.request().postDataJSON();
    if (b.action === 'quota') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ left: quota.left, disabled: quota.disabled }) });
    if (b.action === 'build' && quota.out) { builds.push(b); return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: SPENT, left: 0 }) }); }
    if (b.action === 'concept') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ concept: 'for', label: '반복문 for', by: 'keyword' }) });
    if (b.action === 'examples') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ examples: [{ title: '영수증', situation: '영수증을 모아요.', why: '하나씩 더해요' }] }) });
    if (b.action === 'solve') {
      solves.push(b);
      return solveCode ? r.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: solveCode }) })
        : r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"x"}' });
    }
    builds.push(b);
    if (quota.failRetry && b.ticket) return r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: '문제를 만들지 못했어요. 다시 만들어 주세요.', reasons: {} }) });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...SG_DRAFT(solutions[Math.min(builds.length, solutions.length) - 1]),
      ticket: 'tk-' + builds.length, left: 2 }) });
  });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#gen-lesson').fill('리스트와 반복문');
  await page.locator('#gen-key').fill('하나씩 꺼내 보기');
  if (before) await before();
  await page.locator('#gt-step').click();
  await page.locator('#sg-concept').click();
  await page.locator('#sg-next').click();
  await page.locator('.sg-ex').first().click();
  await page.locator('#sg-wish').fill('운동회 이야기였으면');
  await page.locator('#sg-build').click();
  builds.solves = solves;
  return builds;
}

test('만든 초안을 실행해 자료별 정답과 외우기 함정이 채워진다', async ({ page }) => {
  test.setTimeout(120000);
  const builds = await sgBuild(page, [SG_FOR]);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 60000 });
  await expect(page.locator('#sg-draft')).toContainText('영수증 1의 답과 같은 2300이 나오면 성공');
  await expect(page.locator('#sg-problems')).toBeHidden();
  expect(builds).toHaveLength(1);
  expect(builds[0].wish).toBe('운동회 이야기였으면');
  await expect(page.locator('#sg-title')).toHaveValue('영수증 합치기');
  await expect(page.locator('.sg-card')).toHaveCount(3);
  await expect(page.locator('.sg-opt')).toHaveCount(2);
});

test('검사에 걸리면 이유를 붙여 다시 만든다', async ({ page }) => {
  test.setTimeout(120000);
  const builds = await sgBuild(page, ['print(2300)', 'while not data:\n    pass\n' + SG_FOR, SG_FOR]);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 90000 });
  expect(builds).toHaveLength(3);
  expect(builds[0].problems).toEqual([]);
  expect(builds[1].problems).toContain('반례의 결과가 첫 자료의 결과와 같아요.');
  expect(builds[2].problems.join(' ')).toContain('시간 안에 끝나지 않아요');
  await expect(page.locator('#sg-problems')).toBeHidden();
});

test('자료를 고치면 다시 계산하고, 확정하면 solution 없이 저장한다', async ({ page }) => {
  test.setTimeout(120000);
  await sgBuild(page, [SG_FOR]);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 60000 });
  const v0 = page.locator('.sg-data-val[data-idx="0"]');
  await v0.fill('[1, 2]'); await v0.blur();
  await expect(page.locator('.sg-answer').first()).toHaveText('3', { timeout: 20000 });
  await expect(page.locator('#sg-draft')).toContainText('영수증 1의 답과 같은 3이 나오면 성공');
  const v2 = page.locator('.sg-data-val[data-idx="2"]');
  await v2.fill('[3]'); await v2.blur();
  await expect(page.locator('#sg-problems')).toContainText('반례의 결과가 첫 자료의 결과와 같아요.', { timeout: 20000 });
  await v2.fill('foo('); await v2.blur();          // 리터럴이 아니면 에러 이유로
  await expect(page.locator('#sg-problems')).toContainText('에러가 나요', { timeout: 20000 });
  await v2.fill('[]'); await v2.blur();
  await expect(page.locator('#sg-problems')).toBeHidden({ timeout: 20000 });
  const n0 = page.locator('.sg-data-name[data-idx="0"]');
  await n0.fill('민서 영수증'); await n0.blur();
  await expect(page.locator('#sg-draft')).toContainText('민서 영수증의 답과 같은 3이 나오면 성공');
  await page.locator('#sg-title').fill('운동회 영수증');
  await page.locator('#sg-save').click();
  await expect.poll(() => page.evaluate(() => (window.__saved || []).length)).toBe(1);
  const [[rid, m]] = await page.evaluate(() => window.__saved);
  expect(rid).toBe('r1');
  expect('solution' in m).toBe(false);
  expect('wish' in m).toBe(false);
  expect(JSON.stringify(m)).not.toContain('운동회 이야기였으면');
  expect(m).toMatchObject({ kind: 'code', concept: 'for', no: 'AI', type: 'sentence', title: '운동회 영수증', stage: '운동회 영수증',
    lesson: '리스트와 반복문', keyPoint: '하나씩 꺼내 보기', expected: ['3', '300', '0'] });
  expect(m.id).toMatch(/^ai-[0-9a-z]+$/);
  expect(m.inputs.map(x => x.v)).toEqual(['[1, 2]', '[300]', '[]']);
  expect(m.define.options.map(o => o.trap || null).sort()).toEqual([null, 'hardcode', 'luck'].sort());
  expect(m.define.options.find(o => o.trap === 'hardcode').v).toBe('민서 영수증의 답과 같은 3이 나오면 성공');
  expect(m.inputs[0].name).toBe('민서 영수증');
  expect(m.cards.filter(c => c.decoy)).toHaveLength(1);
  await expect(page.locator('#sg-draft')).toBeEmpty();
});

test('다시 만들기를 두 번 해도 걸리면 초안을 보이고 이유를 노란 상자로', async ({ page }) => {
  test.setTimeout(120000);
  const builds = await sgBuild(page, ['print(sum(data))']);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 60000 });
  expect(builds).toHaveLength(3);
  await expect(page.locator('#sg-problems')).toContainText('풀이 코드에 고른 개념이 쓰이지 않았어요.');
  await expect(page.locator('#sg-draft')).toContainText('영수증 1의 답과 같은 2300이 나오면 성공');
});

test('강사 화면에서 Python 을 못 불러오면 멈추지 않고 그렇다고 말한다', async ({ page }) => {
  await page.route('**/pyodide/**', r => r.abort());
  await sgBuild(page, [SG_FOR]);
  await expect(page.locator('#sg-status')).toContainText('Python을 불러오지 못했어요', { timeout: 20000 });
});

test('따로 푼 답이 다르면 사실 한 줄로 보인다', async ({ page }) => {
  test.setTimeout(120000);
  const builds = await sgBuild(page, [SG_FOR], SG_FOR.replace('print(t)', 'print(t + 1)'));
  await expect(page.locator('#sg-solve')).toHaveText('따로 푼 답과 달라요: 영수증 1 — 2300 / 2301 · 영수증 2 — 300 / 301 · 새 영수증 — 0 / 1', { timeout: 60000 });
  expect(builds.solves).toHaveLength(1);
  expect(JSON.stringify(builds.solves[0])).not.toContain('solution');
  expect(builds.solves[0].inputs[0]).toEqual({ name: '영수증 1', v: '[1500, 800]' });
});

test('따로 푼 답이 같으면 같다고만, 못 풀면 아무것도 안 띄운다', async ({ page }) => {
  test.setTimeout(120000);
  await sgBuild(page, [SG_FOR], SG_FOR);
  await expect(page.locator('#sg-solve')).toHaveText('따로 푼 답과 같아요', { timeout: 60000 });
});

/* sum() 한 번으로 풀리면 for 없이 풀리는 문제다 — 강사에게만 사실 한 줄 */
test('따로 푼 풀이에 고른 개념이 없으면 그렇다고 덧붙인다', async ({ page }) => {
  test.setTimeout(120000);
  await sgBuild(page, [SG_FOR], 'print(sum(data))');
  await expect(page.locator('#sg-solve')).toHaveText('따로 푼 답과 같아요 · 따로 푼 풀이에는 고른 개념(반복문 for)이 쓰이지 않았어요', { timeout: 60000 });
});

test('따로 풀기가 실패하면 줄은 비어 있다', async ({ page }) => {
  test.setTimeout(120000);
  const builds = await sgBuild(page, [SG_FOR]);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 60000 });
  await expect.poll(() => builds.solves.length).toBe(1);
  await page.waitForTimeout(500);
  await expect(page.locator('#sg-solve')).toBeEmpty();
});

test('판정을 저장하면 모든 자료로 조용히 돌린 기록이 남고 학생 화면은 그대로다', async ({ page }) => {
  test.setTimeout(120000);
  await local(page.context());
  await seedMission(page);
  await studentToCode(page);
  await waitPython(page);
  const probes = () => page.evaluate(() => JSON.parse(localStorage.getItem('cutcheck.log.v1') || '[]').filter(e => e.type === 's-probe'));
  await page.locator('#code-editor').fill('data = "x"\nprint(len(set(data.split(","))))\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toBeVisible({ timeout: 10000 });
  await page.locator('#code-judge .judge-btn').first().click();
  await page.locator('#code-judge-save').click();
  await expect.poll(async () => (await probes()).length, { timeout: 20000 }).toBe(1);
  const p = (await probes())[0];
  expect(p.outs.length).toBe(3);
  expect(p.outs[2].output.trim()).toBe('4');
  expect(Array.isArray(p.uses)).toBe(true);
  // usesCode 가 공유 worker 에 json·ast 를 남기지 않는다 — 다음 학생 실행에서 import 없이 되면 안 된다
  await page.locator('#code-editor').fill('print(("json" in globals(), "ast" in globals(), "_t" in globals()))\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toHaveText('(False, False, False)', { timeout: 10000 });
  await page.locator('#go-wrap').click();
  await expect(page.locator('#wrap-review')).toContainText('False');   // 보이는 실행만 — probe 의 4 는 정리 화면에 없다
  await expect(page.locator('#wrap-review')).not.toContainText('4');
});

test('마지막 실행이 에러면 조용한 실행 기록은 없다', async ({ page }) => {
  test.setTimeout(120000);
  await local(page.context());
  await seedMission(page);
  await studentToCode(page);
  await waitPython(page);
  await page.locator('#code-editor').fill('print(item)\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toContainText('1번째 줄', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const n = await page.evaluate(() => JSON.parse(localStorage.getItem('cutcheck.log.v1') || '[]').filter(e => e.type === 's-probe').length);
  expect(n).toBe(0);
});

test('조용한 실행이 도는 사이 다른 미션을 열어도 기록은 처음 미션 것이다', async ({ page }) => {
  test.setTimeout(120000);
  await local(page.context());
  await seedMission(page);
  await studentToCode(page);
  await waitPython(page);
  await page.locator('#code-editor').fill('import time\ntime.sleep(0.6)\ndata = "x"\nprint(len(data.split(",")))\n');
  await page.locator('#run-code').click();
  await expect(page.locator('#code-result')).toBeVisible({ timeout: 10000 });
  await page.locator('#code-judge .judge-btn').first().click();
  await page.locator('#code-judge-save').click();
  await page.locator('.m-btn[data-id="sm2"]').click();   // 자료 3개를 도는 2초 남짓 사이에 다른 미션으로
  const probes = () => page.evaluate(() => JSON.parse(localStorage.getItem('cutcheck.log.v1') || '[]').filter(e => e.type === 's-probe'));
  await expect.poll(async () => (await probes()).length, { timeout: 30000 }).toBe(1);
  const p = (await probes())[0];
  expect(p.mid).toBe('ai-e2e');
  const want = await page.evaluate(() => window.CC.SENTENCE_MISSIONS[0].inputs.map(i => i.v));
  expect(p.outs.map(o => o.dataId)).toEqual(want);
});

test('서랍에 코드 사실과 설계·코드 나란히', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.addInitScript(() => {
    window.__facts = 1;
    localStorage.setItem('cutcheck.generated', JSON.stringify([{ id: 'mx', kind: 'code', concept: 'while', title: '합계', inputs: [{ name: '영수증', v: '[1, 2]' }, { name: '빈 상자', v: '[]', counter: true }] }]));
  });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const d = page.locator('#detail');
  await expect(d.getByText('코드 사실', { exact: true })).toHaveCount(2);
  await expect(d).toContainText('새로 온 자료에서도 영수증과 같은 결과 3이 나와요');
  await expect(d).toContainText('오늘 개념(반복문 while)이 코드에 없어요');
  const a = await d.locator('.d-pair-cards').boundingBox();
  const b = await d.locator('.d-pair-code').boundingBox();
  expect(a && b && Math.abs(a.y - b.y) < 4 && b.x > a.x).toBeTruthy();       // 나란히
  await page.setViewportSize({ width: 400, height: 900 });
  const a2 = await d.locator('.d-pair-cards').boundingBox();
  const b2 = await d.locator('.d-pair-code').boundingBox();
  expect(b2.y).toBeGreaterThan(a2.y);                                           // 좁으면 위아래
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
});

/* ── 최종 리뷰 수정 (2026-10-20) ── */

/* pyrun 의 run 을 감싸 genflow 가 돌린 코드를 센다 — create 는 처음 만들 때 불린다 */
function spyRuns(page) {
  return page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const c = window.CC.pyrun.create;
      window.__runs = [];
      window.CC.pyrun.create = (s) => {
        const p = c(s), r = p.run;
        p.run = (code, cb) => { const k = { code }; window.__runs.push(k); r(code, (o, e) => { k.error = e; cb(o, e); }); };
        return p;
      };
    });
  });
}

test('따로 풀기는 자료마다 차례로 돌고 첫 에러(시간 초과)에서 멈춘다', async ({ page }) => {
  test.setTimeout(120000);
  await spyRuns(page);
  const builds = await sgBuild(page, [SG_FOR], 'while True:\n    pass\nprint(1)');
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 60000 });
  const solveRuns = () => page.evaluate(() => window.__runs.filter(k => k.code.indexOf('while True') >= 0));
  await expect.poll(async () => (await solveRuns()).filter(k => k.error).length, { timeout: 20000 }).toBe(1);
  await page.waitForTimeout(1500);
  const rs = await solveRuns();
  expect(rs).toHaveLength(1);                                   // 나머지 두 자료는 넣지 않았다
  expect(rs[0].error).toBe(await page.evaluate(() => CC.pyerr.TIMEOUT));
  await expect(page.locator('#sg-solve')).toBeEmpty();
  expect(builds.solves).toHaveLength(1);
});

test('자료를 고치는 순간 옛 따로 풀기 결과는 지워진다', async ({ page }) => {
  test.setTimeout(120000);
  await sgBuild(page, [SG_FOR], SG_FOR);
  await expect(page.locator('#sg-solve')).toHaveText('따로 푼 답과 같아요', { timeout: 60000 });
  const v0 = page.locator('.sg-data-val[data-idx="0"]');
  await v0.fill('[1, 2]');
  await v0.blur();                                              // change → rerun 이 동기로 돈다
  expect(await page.locator('#sg-solve').textContent()).toBe('');
  await expect(page.locator('#sg-solve')).toHaveText('따로 푼 답과 같아요', { timeout: 60000 });   // 새 자료로 다시 푼다
});

test('수업 내용 없이 개념 확인을 누르면 보이는 자리에 말한다', async ({ page }) => {
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#sg-concept').click();
  await expect(page.locator('#gen-result')).toHaveText('수업 내용을 입력해주세요.');
  await expect(page.locator('#gen-result')).toBeVisible();
  await expect(page.locator('#gp-count')).toHaveText('1 / 4 수업 내용');   // 1단계에 머문다
});

test('기록을 읽기 전에 지정 풀기를 눌러도 다시 지정되지 않는다', async ({ page }) => {
  await page.addInitScript(() => { window.__evHang = 1; window.__due = 's2'; });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-invite"]').click();
  const 가은 = page.locator('.roster-row', { hasText: '가은' });
  await expect(가은.locator('.roster-test')).toHaveText('레벨 테스트 지정 풀기');
  await 가은.locator('.roster-test').click();
  await expect.poll(() => page.evaluate(() => window.__assigned)).toEqual([['r1', 's2', false]]);
});

test('수정을 눌렀다가 단계별로 확정하면, 다음 빠른 생성은 그 미션을 덮어쓰지 않는다', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => { window.__missions = [{ id: 'm-old', data: { title: '옛 미션', brief: '옛 요청', lesson: '옛 수업', keyPoint: '옛 핵심' } }]; });
  const fixture = require('./fixtures/mission.json');
  await page.route('**/api/generate-mission', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ...fixture, guard: { fallback: [], reasons: {} } }) }));
  await sgBuild(page, [SG_FOR], null, async () => {
    await page.locator('#mission-list button', { hasText: '수정' }).click();
    await expect(page.locator('#gen-btn')).toHaveText('초안 다시 생성');
    await page.locator('#gen-lesson').fill('리스트와 반복문');
  });
  await expect(page.locator('#gen-btn')).toHaveText('빠른 생성');
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 60000 });
  await page.locator('#sg-save').click();
  await expect.poll(() => page.evaluate(() => (window.__saved || []).length)).toBe(1);
  await page.locator('#gt-quick').click();
  await page.locator('#gen-key').fill('하나씩 꺼내 보기');
  await page.locator('#gen-btn').click();
  await page.locator('#confirm-mission').click();
  await expect.poll(() => page.evaluate(() => (window.__saved || []).length)).toBe(2);
  expect(await page.evaluate(() => window.__updated || [])).toEqual([]);
});

/* worker 안의 코드가 js 모듈로 바깥(fetch·postMessage)에 닿지 못한다 */
test('실행기 — worker 안에서 js·pyodide 모듈은 막혀 있고 보통 코드는 돈다', async ({ context, page }) => {
  test.setTimeout(90000);
  await local(context);
  await page.goto(BASE + '/sentence.html');
  const r = await page.evaluate(() => new Promise(resolve => {
    const py = window.CC.pyrun.create((t, ok) => {
      if (!ok) return;
      const got = [];
      const codes = ['import js', 'import sys\ndel sys.modules["js"]\nimport js', 'import pyodide_js', 'from pyodide.code import run_js', 'print(sorted({3, 1, 2}))'];
      codes.forEach(c => py.run(c, (o, e) => { got.push([o, e]); if (got.length === codes.length) resolve(got); }));
    });
  }));
  r.slice(0, 4).forEach(([o, e]) => expect(e).toMatch(/ModuleNotFoundError/));
  expect(r[4]).toEqual(['[1, 2, 3]\n', '']);
});

/* worker 가 준비된 뒤 죽으면 그 실행만 실패 — 메인 스레드(시간 제한·격리 없음)로 옮겨 다시 돌리지 않는다.
 * 실행 번호가 다른 'done' 은 무시한다 */
const FAKE_WORKER = `postMessage({ type: 'ready' });
onmessage = function (e) {
  var d = e.data;
  if (d.code === 'crash') { setTimeout(function () { throw new Error('boom'); }); return; }
  postMessage({ type: 'done', id: 1, output: 'FAKE1', error: '' });
  postMessage({ type: 'done', id: String(d.id) + 'x', output: 'FAKE2', error: '' });
  postMessage({ type: 'done', id: d.id, output: 'ok:' + d.code + ':' + typeof d.id + ':' + String(d.id).length, error: '' });
};`;

test('실행기 — 준비된 worker 가 죽으면 그 실행만 실패하고 메인 스레드로 가지 않는다', async ({ context, page }) => {
  await local(context);
  await page.route('**/pyodide/**', r => r.abort());
  await page.route('**/js/ui/pyworker.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_WORKER }));
  await page.goto(BASE + '/sentence.html');
  const r = await page.evaluate(() => new Promise(resolve => {
    window.loadPyodide = () => { window.__mainBoot = 1; return new Promise(() => {}); };
    let started = false;
    const got = [];
    const py = window.CC.pyrun.create((t, ok) => {
      if (!ok || started) return;
      started = true;
      py.run('a', (o, e) => got.push([o, e]));
      py.run('crash', (o, e) => got.push([o, e]));
      py.run('b', (o, e) => { got.push([o, e]); resolve({ got, main: !!window.__mainBoot }); });
    });
  }));
  expect(r.main).toBe(false);
  expect(r.got[1]).toEqual(['', 'Python 실행기가 멈췄어요.']);
  expect(r.got[0][0]).toMatch(/^ok:a:string:/);                // 지어낸 id 1·id+'x' 의 done 은 버렸다
  expect(Number(r.got[0][0].split(':')[3])).toBeGreaterThan(6); // 맞히기 어려운 실행 번호
  expect(r.got[2][0]).toMatch(/^ok:b:/);                         // 새 worker 로 이어서 돈다
});

/* 수업에서 짚을 거리 — 진짜 CC.sb.recap(캐시) 위에 가짜 서버. /api/tutor-recap 은 route 로 고정 응답 */
const RECAP_SB = require('fs').readFileSync(__dirname + '/../js/data/supabase.js', 'utf8') +
  '\n;window.__R=CC.sb.recap;\n' + FAKE_TEACHER + '\n;CC.sb.recap=window.__R;';
const rv = (sid, name, type, mid, o) => ({ student_id: sid, created_at: new Date().toISOString(), profiles: { name },
  event: Object.assign({ type, mid, v: 1, t: Date.now() }, o) });
const RECAP_EVS = [
  rv('s1', '태인', 's-define', 'ma', { choice: '몇 개' }),
  rv('s1', '태인', 's-tutor', 'ma', { question: 'split 이 뭐예요?', answer: '나눠요', refused: false }),
  rv('s1', '태인', 's-wrap', 'ma', { text: '끝' }),
  rv('s1', '태인', 's-tutor', 'mb', { question: '이건요?', answer: '음', refused: false }),
  rv('s3', '한결', 's-tutor', 'ma', { question: '답 알려줘요', answer: '', refused: true }),
  rv('s3', '한결', 's-wrap', 'ma', { text: '끝' })
];
async function asRecapTeacher(page, evs, reply) {
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: RECAP_SB }));
  const calls = [];
  await page.route('**/api/tutor-recap', r => { calls.push(r.request().postDataJSON()); return r.fulfill(reply); });
  if (evs) await page.addInitScript(e => { window.__evs = e; }, evs);
  await page.goto(BASE + '/teacher.html');
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  return calls;
}
const ok = items => ({ contentType: 'application/json', body: JSON.stringify({ items }) });

test('강사 서랍 — 끝낸 미션에만 수업에서 짚을 거리, 누르면 point · 펼치면 질문', async ({ page }) => {
  const calls = await asRecapTeacher(page, RECAP_EVS, ok([
    { point: 'split 이 돌려주는 것', who: ['s1'], mid: 'ma', quote: 'split 이 뭐예요?', refused: false },
    { point: '답을 달라고 함', who: ['s1'], mid: 'ma', quote: 'split 이 뭐예요?', refused: true }]));
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const d = page.locator('#detail');
  await expect(d).not.toContainText('수업에서 짚을 거리');           // 미션을 고르지 않고 연 서랍에는 없다
  await expect(d.locator('.recap-go')).toHaveCount(0);
  await d.locator('#detail-back').click();
  await page.evaluate(e => { window.__evs.push(e); }, rv('s1', '태인', 's-redefine', 'ma', { to: '다른 조건' }));   // 알림이 ma 를 골라 연다
  await page.locator('#alert-list li', { hasText: '태인' }).locator('.al-it').first().click({ timeout: 10000 });
  const row = d.locator('.d-tutor');
  await row.getByRole('button', { name: '튜터 대화에서 뽑기' }).click();
  const items = row.locator('.recap-item');
  await expect(items).toHaveCount(2);
  await expect(items.first().locator('summary')).toHaveText('split 이 돌려주는 것');
  await expect(items.first().locator('.quote')).toBeHidden();
  await items.first().locator('summary').click();
  await expect(items.first().locator('.quote')).toHaveText('“split 이 뭐예요?”');
  await expect(items.nth(1).locator('.tag')).toHaveText('튜터가 답하지 못함');
  expect(calls.length).toBe(1);
  await d.locator('#detail-back').click();
  await page.evaluate(e => { window.__evs.push(e); }, rv('s1', '태인', 's-redefine', 'mb', { to: '또 다른 조건' }));
  await expect(page.locator('#alert-list li', { hasText: '태인' })).toHaveCount(2, { timeout: 10000 });   // ma 알림은 확인 전까지 남는다
  await page.locator('#alert-list li', { hasText: '태인' }).locator('.al-it').first().click();   // 알림 — 끝내지 않은 mb (새것이 위)
  await expect(d.locator('details.k-fold[open] > summary')).toContainText('미션 2');
  await expect(d.locator('.d-tutor .recap-go')).toHaveCount(0);       // 끝내지 않은 미션에는 짚을 거리가 없다
  expect(calls[0].students.map(x => x.mid)).toEqual(['ma']);
  expect(JSON.stringify(calls[0])).not.toContain('태인');              // 이름은 서버로 가지 않는다
});

test('강사 반 전체 — 많은 순, N명 · 펼치면 이름, 두 번 눌러도 요청 한 번', async ({ page }) => {
  let calls;
  calls = await asRecapTeacher(page, RECAP_EVS, { contentType: 'application/json', body: '{}' });
  await page.unroute('**/api/tutor-recap');
  await page.route('**/api/tutor-recap', r => {
    const who = r.request().postDataJSON().students.map(x => x.who);
    calls.push(1);
    return r.fulfill(ok([
      { point: '하나만', who: [who[0]], mid: 'ma', quote: 'split 이 뭐예요?', refused: false },
      { point: '둘 다', who: who, mid: 'ma', quote: '답 알려줘요', refused: true }]));
  });
  await page.locator('#recap-class').click();
  const items = page.locator('#recap-class-out .recap-item');
  await expect(items).toHaveCount(2);
  await expect(items.first().locator('.pt')).toHaveText('둘 다');
  await expect(items.first().locator('.n')).toHaveText('2명');
  await items.first().locator('summary').click();
  const who = await items.first().locator('.who').textContent();
  expect(who).toContain('태인'); expect(who).toContain('한결'); expect(who).not.toMatch(/s\d/);
  await page.locator('#recap-class').click();
  await expect(items).toHaveCount(2);
  expect(calls.length).toBe(1);
});

test('강사 반 전체 — 튜터 대화가 없으면 요청 없이 한 줄', async ({ page }) => {
  const calls = await asRecapTeacher(page, null, ok([]));
  await page.locator('#recap-class').click();
  await expect(page.locator('#recap-class-out')).toHaveText('튜터와 대화하고 끝낸 미션이 아직 없어요.');
  expect(calls.length).toBe(0);
});

test('강사 반 전체 — 서버가 실패하면 다시 누르라는 한 줄', async ({ page }) => {
  await asRecapTeacher(page, RECAP_EVS, { status: 502, contentType: 'application/json', body: '{"error":"x"}' });
  await page.locator('#recap-class').click();
  await expect(page.locator('#recap-class-out')).toHaveText('지금은 뽑지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  await expect(page.locator('#recap-class')).toBeEnabled();
});

test('강사 서랍 — 끝낸 미션이 하나뿐이면 고르지 않아도 수업에서 짚을 거리', async ({ page }) => {
  await asRecapTeacher(page, RECAP_EVS.slice(0, 3), ok([]));
  await page.locator('.student-tile', { hasText: '태인' }).click();
  await expect(page.locator('#detail .d-tutor .recap-go')).toBeVisible();
});

test('강사 반 전체 — 빈 결과는 캐시하지 않아 다시 누르면 서버를 다시 부른다', async ({ page }) => {
  const calls = await asRecapTeacher(page, RECAP_EVS, ok([]));
  await page.locator('#recap-class').click();
  await expect(page.locator('#recap-class-out')).toContainText('짚을 거리가 나오지 않았어요');
  await page.locator('#recap-class').click();
  await expect(page.locator('#recap-class-out')).toContainText('짚을 거리가 나오지 않았어요');
  expect(calls.length).toBe(2);
});

/* 생성 한도 (2026-10-20) — 남은 수는 서버가 알려 준 대로만 보인다. 0 이면 두 생성 버튼을 끈다 */
test('남은 생성 — 처음 수를 보이고, 만들기가 성공하면 줄고, 재요청에는 직전 ticket 을 싣는다', async ({ page }) => {
  test.setTimeout(120000);
  const builds = await sgBuild(page, ['print(2300)', SG_FOR]);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 90000 });
  expect(builds).toHaveLength(2);
  expect('ticket' in builds[0]).toBe(false);                 // 새 "만들기" 는 ticket 없이
  expect(builds[1].ticket).toBe('tk-1');                     // 검사에 걸린 재요청은 첫 응답의 ticket
  expect(builds[0].lesson).toBe('리스트와 반복문');           // 관리자 기록에 수업 내용이 남게
  await expect(page.locator('.gen-left').first()).toHaveText('남은 생성 2개');
  await page.locator('.gp-s[data-step="3"] .gp-fix').click();
  await page.locator('#sg-build').click();                   // 다시 누른 "만들기" 는 새 미션 — ticket 없이
  await expect.poll(() => builds.length).toBe(3);
  expect('ticket' in builds[2]).toBe(false);
});

/* 2026-10-20 운영: 첫 초안은 차감되고 저장됐는데 자동 재요청이 422 로 끝나자 초안까지 버려 "남은 생성 2개 + 만들지 못했어요"만 남았다.
 * 재요청이 실패하면 이미 만든 초안을 걸린 이유와 함께 보여 준다 — 낸 횟수로 받은 것을 잃지 않는다 */
test('자동 재요청이 실패해도 이미 만든 초안은 걸린 이유와 함께 남는다', async ({ page }) => {
  test.setTimeout(120000);
  const builds = await sgBuild(page, ['print(2300)'], null, null, { left: 3, disabled: false, failRetry: true });
  await expect.poll(() => builds.length, { timeout: 90000 }).toBe(2);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '2300', '2300'], { timeout: 60000 });
  await expect(page.locator('#sg-problems')).toBeVisible();
  await expect(page.locator('#sg-title')).toHaveValue('영수증 합치기');
  await expect(page.locator('#sg-status')).toContainText('처음 만든 문제를 보여 드려요');
});

test('남은 생성 — 열면 서버가 준 수, 403 left 0 이면 두 버튼이 꺼지고 문장', async ({ page }) => {
  const builds = await sgBuild(page, [SG_FOR], null, async () => {
    await expect(page.locator('.gen-left')).toHaveText(Array(5).fill('남은 생성 3개'));
  }, { left: 3, disabled: false, out: true });
  await expect.poll(() => builds.length).toBe(1);
  await expect(page.locator('#gen-btn')).toBeDisabled();
  await expect(page.locator('#sg-build')).toBeDisabled();
  await expect(page.locator('.gen-left').first()).toHaveText(SPENT);
  await page.locator('.sg-ex').first().click();              // 예시를 다시 골라도 꺼진 채로
  await expect(page.locator('#sg-build')).toBeDisabled();
});

test('남은 생성 — 빠른 생성도 left 로 갱신하고, 0 이 되면 꺼진다', async ({ page }) => {
  const fixture = require('./fixtures/mission.json');
  await page.route('**/api/mission-steps', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ left: 1, disabled: false }) }));
  await page.route('**/api/generate-mission', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ...fixture, guard: { fallback: [], reasons: {} }, left: 0 }) }));
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#gt-quick').click();
  await expect(page.locator('.gen-left').first()).toHaveText('남은 생성 1개');
  await expect(page.locator('#t-admin')).toBeVisible();       // 로그인한 강사에게만 관리자 화면 링크
  await page.locator('#gen-lesson').fill('리스트와 반복문');
  await page.locator('#gen-key').fill('같은 값이 여러 번 나올 때');
  await page.locator('#gen-btn').click();
  await expect(page.locator('#confirm-mission')).toBeVisible();
  await expect(page.locator('.gen-left').first()).toHaveText(SPENT);
  await expect(page.locator('#gen-btn')).toBeDisabled();
  await page.locator('#confirm-mission').click();
  await expect.poll(() => page.evaluate(() => (window.__saved || []).length)).toBe(1);
  expect('left' in (await page.evaluate(() => window.__saved[0][1]))).toBe(false);   // 남은 수는 미션에 섞이지 않는다
});

test('남은 생성 — 빠른 생성이 403 left 0 이면 두 버튼이 꺼진다', async ({ page }) => {
  await page.route('**/api/mission-steps', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ left: 2, disabled: false }) }));
  await page.route('**/api/generate-mission', r => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: SPENT, left: 0 }) }));
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.locator('#gt-quick').click();
  await page.locator('#gen-lesson').fill('리스트와 반복문');
  await page.locator('#gen-key').fill('같은 값이 여러 번 나올 때');
  await page.locator('#gen-btn').click();
  await expect(page.locator('#gen-result')).toHaveText(SPENT);
  await expect(page.locator('#gen-btn')).toBeDisabled();
  await expect(page.locator('#sg-build')).toBeDisabled();
  await expect(page.locator('.gen-left').first()).toHaveText(SPENT);
});

test('남은 생성 — 로컬 모드에서는 묻지도 보이지도 않는다', async ({ context, page }) => {
  await local(context);
  const asked = [];
  await page.route('**/api/mission-steps', r => { asked.push(1); return r.abort(); });
  await page.goto(BASE + '/teacher.html');
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await page.waitForTimeout(300);
  expect(asked).toHaveLength(0);
  for (const t of await page.locator('.gen-left').allTextContents()) expect(t).toBe('');
  await expect(page.locator('#t-admin')).toBeHidden();
  await expect(page.locator('#gen-btn')).toBeEnabled();
});

/* 관리자 화면 (2026-10-20) — 서버(/api/admin)가 관리자만 받는다. 표는 서버가 준 순서(이름순) 그대로, 사용량으로 줄 세우지 않는다 */
const T1 = '11111111-1111-1111-1111-111111111111', T2 = '22222222-2222-2222-2222-222222222222';
const ADMIN_LIST = { default_quota: 3, teachers: [
  { id: T1, name: '가람', email: 'garam@example.test', used: 1, quota: 3, left: 2, disabled: false },
  { id: T2, name: '나래', email: 'narae@example.test', used: 3, quota: 3, left: 0, disabled: false }] };
const EVIL = '<img src=x onerror="window.__pwned=1">';

async function asAdmin(page, handle) {
  const reqs = [];
  await page.route('**/api/admin', async r => {
    const b = r.request().postDataJSON();
    reqs.push(b);
    const [status, body] = handle(b);
    return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_TEACHER }));
  await page.goto(BASE + '/admin.html');
  return reqs;
}

test('관리자 — 관리자가 아니면 한 줄만, 표는 없다', async ({ page }) => {
  await asAdmin(page, () => [403, { error: '관리자만 볼 수 있어요.' }]);
  await expect(page.locator('#ad-note')).toHaveText('관리자만 볼 수 있어요.');
  await expect(page.locator('#ad-main')).toBeHidden();                   // 표 둘 다 이 안에 있다
  await expect(page.locator('table:visible')).toHaveCount(0);
});

test('관리자 — 강사 표, 한도를 바꾸면 그 줄만 갱신, 범위 밖이면 서버 문장이 그 줄 옆에', async ({ page }) => {
  const reqs = await asAdmin(page, b => {
    if (b.action === 'list') return [200, ADMIN_LIST];
    if (b.action === 'log') return [200, { log: [{ at: '2026-10-20T01:02:03Z', teacher: '가람', lesson: EVIL, concept: 'for', kind: 'step', retries: 1 },
      { at: '2026-10-20T00:00:00Z', teacher: '나래', lesson: '리스트', concept: 'list', kind: 'quick', retries: 0 }] }];
    if (b.action === 'set_quota' && b.quota > 1000) return [400, { error: '한도는 0 이상 1000 이하 정수로 정해 주세요.' }];
    if (b.action === 'set_quota') return [200, { ...ADMIN_LIST.teachers[1], quota: b.quota, left: b.quota - 3 }];
    return [400, { error: '요청 형식이 잘못됐어요.' }];
  });
  const rows = page.locator('#ad-teachers tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('가람');
  await expect(rows.nth(0)).toContainText('garam@example.test');
  const q = rows.nth(1).locator('input[type="number"]');
  await q.fill('5'); await q.blur();
  await expect(rows.nth(1).locator('td[data-l="남은"]')).toHaveText('2');
  expect(reqs.find(b => b.action === 'set_quota')).toEqual({ action: 'set_quota', id: T2, quota: 5 });
  await expect(rows.nth(1).locator('input[type="number"]')).toHaveValue('5');
  const q2 = rows.nth(0).locator('input[type="number"]');
  await q2.fill('1001'); await q2.blur();
  await expect(rows.nth(0).locator('.ad-msg')).toHaveText('한도는 0 이상 1000 이하 정수로 정해 주세요.');
  await expect(page.locator('#ad-default')).toHaveValue('3');
  const log = page.locator('#ad-log tbody tr');
  await expect(log).toHaveCount(2);
  await expect(log.nth(0)).toContainText(EVIL);                 // 강사가 쓴 수업 내용은 글자로만
  await expect(log.nth(0)).toContainText('단계별');
  await expect(log.nth(0).locator('td').nth(3)).toHaveText('반복문 for');   // 아는 개념은 이름으로
  await expect(log.nth(1).locator('td').nth(3)).toHaveText('list');         // 모르는 id 는 그대로
  await expect(log.nth(1)).toContainText('빠른');
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await expect(page.locator('#ad-log img')).toHaveCount(0);
});

test('관리자 — 생성 끄기와 기본 한도, 폰 폭에서도 화면은 옆으로 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 });
  const reqs = await asAdmin(page, b => {
    if (b.action === 'list') return [200, ADMIN_LIST];
    if (b.action === 'log') return [200, { log: [] }];
    if (b.action === 'set_disabled') return [200, { ...ADMIN_LIST.teachers[0], disabled: b.disabled, left: 0 }];
    if (b.action === 'set_default') return [200, { default_quota: b.quota }];
    return [400, { error: '요청 형식이 잘못됐어요.' }];
  });
  const row = page.locator('#ad-teachers tbody tr').first();
  await row.locator('input[type="checkbox"]').check();
  await expect(page.locator('#ad-teachers tbody tr').first().locator('td[data-l="남은"]')).toHaveText('꺼짐');
  expect(reqs.find(b => b.action === 'set_disabled')).toEqual({ action: 'set_disabled', id: T1, disabled: true });
  await page.locator('#ad-default').fill('7'); await page.locator('#ad-default').blur();
  await expect.poll(() => reqs.filter(b => b.action === 'set_default').length).toBe(1);
  expect(reqs.find(b => b.action === 'set_default')).toEqual({ action: 'set_default', quota: 7 });
  const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(o).toBeLessThanOrEqual(0);
});

/* ── 관리자 화면 틀과 고칠 것 (2026-10-20, shell) ── */
test('관리자 — 왼쪽 사이드바 틀, 오른쪽 패널 없음, 로그인 링크는 로그인이 안 됐을 때만', async ({ page }) => {
  await page.addInitScript(() => { window.__noProfile = 1; });
  await asAdmin(page, () => [200, {}]);
  await expect(page.locator('#ad-main')).toBeHidden();
  await expect(page.locator('#side')).toBeVisible();
  await expect(page.locator('#alerts, aside')).toHaveCount(0);
  await expect(page.locator('#ad-note a[href="auth.html"]')).toHaveText('로그인');
  expect(page.url()).toContain('admin.html');                          // 조용히 옮기지 않는다
  await expect(page.locator('#side a[href="teacher.html"]')).toBeVisible();
});

test('관리자 — 저장 중에는 그 줄이 잠기고 요청은 한 번, 저장했어요는 3초 뒤 사라진다', async ({ page }) => {
  let release;
  const gate = new Promise(r => { release = r; });
  const reqs = [];
  await page.route('**/api/admin', async r => {
    const b = r.request().postDataJSON(); reqs.push(b);
    if (b.action === 'list') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADMIN_LIST) });
    if (b.action === 'log') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ log: [] }) });
    await gate;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...ADMIN_LIST.teachers[0], quota: b.quota, left: b.quota - 1 }) });
  });
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_TEACHER }));
  await page.goto(BASE + '/admin.html');
  const row = page.locator('#ad-teachers tbody tr').first();
  const q = row.locator('input[type="number"]');
  await q.fill('4'); await q.blur();
  await expect(q).toBeDisabled();
  await expect(row.locator('input[type="checkbox"]')).toBeDisabled();
  await expect(row.locator('.ad-msg')).toHaveText('저장 중이에요.');
  expect(reqs.filter(b => b.action === 'set_quota').length).toBe(1);
  release();
  const msg = page.locator('#ad-teachers tbody tr').first().locator('.ad-msg');
  await expect(msg).toHaveText('저장했어요.');
  await expect(page.locator('#ad-teachers tbody tr').first().locator('input[type="number"]')).toHaveValue('4');
  await expect(msg).toHaveText('', { timeout: 5000 });
});

test('관리자 — 기본 한도도 저장했어요, 기록이 비면 안내 한 줄, 다 씀과 꺼짐은 글자로 다르다', async ({ page }) => {
  const reqs = await asAdmin(page, b => {
    if (b.action === 'list') return [200, { default_quota: 3, teachers: [
      ...ADMIN_LIST.teachers,
      { id: 'x3', name: '다온', email: 'daon@example.test', used: 0, quota: 0, left: 0, disabled: true }] }];
    if (b.action === 'log') return [200, { log: [] }];
    if (b.action === 'set_default') return [200, { default_quota: b.quota }];
    return [400, { error: 'x' }];
  });
  await expect(page.locator('#ad-log-empty')).toHaveText('아직 만든 미션이 없어요.');
  await expect(page.locator('#ad-log')).toBeHidden();
  const left = i => page.locator('#ad-teachers tbody tr').nth(i).locator('td[data-l="남은"]');
  await expect(left(0)).toHaveText('2');
  await expect(left(1)).toContainText('다 씀');
  await expect(left(2)).toHaveText('꺼짐');
  await page.locator('#ad-default').fill('7'); await page.locator('#ad-default').blur();
  await expect(page.locator('#ad-default-msg')).toHaveText('저장했어요.');
  await expect(page.locator('#ad-default-msg')).toHaveText('', { timeout: 5000 });
});

test('관리자 — 390px 카드, 가로 스크롤 없음, 같은 이름도 이메일로 구분, 오류가 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asAdmin(page, b => {
    if (b.action === 'list') return [200, { default_quota: 3, teachers: [
      { ...ADMIN_LIST.teachers[0], name: '김선생' }, { ...ADMIN_LIST.teachers[1], name: '김선생' }] }];
    if (b.action === 'log') return [200, { log: [{ at: '2026-10-20T01:02:03Z', teacher: '김선생', lesson: '아주긴수업내용'.repeat(10), concept: 'for', kind: 'step', retries: 0 }] }];
    return [400, { error: '한도는 0 이상 1000 이하 정수로 정해 주세요.' }];
  });
  const rows = page.locator('#ad-teachers tbody tr');
  await expect(rows.nth(0)).toContainText('garam@example.test');
  await expect(rows.nth(1)).toContainText('narae@example.test');
  const q = rows.nth(0).locator('input[type="number"]');
  await expect(q).toHaveAttribute('aria-label', /김선생.*garam@example.test|garam@example.test.*김선생/);
  await q.fill('2000'); await q.blur();
  const m = rows.nth(0).locator('.ad-msg');
  await expect(m).toBeVisible();
  const b = await m.boundingBox();
  expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(390);
  expect(b.height).toBeLessThan(80);                                   // 한 글자씩 줄바꿈하지 않는다
  await expect(q).toBeEnabled();                                       // 실패하면 다시 고칠 수 있다
  for (const e of [q, rows.nth(0).locator('.ad-off')]) {
    const bb = await e.boundingBox(); expect(bb.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('관리자 — 응답이 없으면 줄이 풀리고 안내가 뜨며, 저장되면 키보드 자리가 그대로다', async ({ page }) => {
  await page.addInitScript(() => { window.CC = { adminTimeout: 600 }; });
  let hang = true;
  await page.route('**/api/admin', async r => {
    const b = r.request().postDataJSON();
    const ok = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (b.action === 'list') return ok(ADMIN_LIST);
    if (b.action === 'log') return ok({ log: [] });
    if (hang) return;                                                 // 끝내 답하지 않는다
    return ok({ ...ADMIN_LIST.teachers[0], quota: b.quota, left: b.quota - 1 });
  });
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_TEACHER }));
  await page.goto(BASE + '/admin.html');
  const row = () => page.locator('#ad-teachers tbody tr').first();
  await row().locator('input[type="number"]').fill('4'); await row().locator('input[type="number"]').blur();
  await expect(row().locator('.ad-msg')).toHaveText('응답이 없어요. 다시 해 주세요.', { timeout: 3000 });
  await expect(row().locator('input[type="number"]')).toBeEnabled();
  await expect(row().locator('input[type="number"]')).toHaveValue('3');
  hang = false;
  await row().locator('input[type="number"]').fill('4');
  await row().locator('input[type="number"]').press('Tab');            // 키보드 자리는 바꾼 칸으로 돌아온다
  await expect(row().locator('.ad-msg')).toHaveText('저장했어요.');
  await expect(row().locator('input[type="number"]')).toBeFocused();
});

test('관리자 — 기본 한도 저장이 저장 중인 줄을 덮어 그리지 않고, 목록 실패는 따로 알린다', async ({ page }) => {
  let release, listFail = false;
  const gate = new Promise(r => { release = r; });
  await page.route('**/api/admin', async r => {
    const b = r.request().postDataJSON();
    const ok = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (b.action === 'list') return listFail ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '목록 오류' }) }) : ok(ADMIN_LIST);
    if (b.action === 'log') return ok({ log: [] });
    if (b.action === 'set_default') return ok({ default_quota: b.quota });
    await gate;
    return ok({ ...ADMIN_LIST.teachers[0], quota: b.quota, left: b.quota - 1 });
  });
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_TEACHER }));
  await page.goto(BASE + '/admin.html');
  const q = page.locator('#ad-teachers tbody tr').first().locator('input[type="number"]');
  await q.fill('4'); await q.blur();
  await expect(q).toBeDisabled();
  await page.locator('#ad-default').fill('7'); await page.locator('#ad-default').blur();
  await expect(page.locator('#ad-default-msg')).toHaveText('저장했어요.');
  await expect(q).toBeDisabled();                                      // 같은 줄이 그대로(다시 그려지지 않았다)
  release();
  await expect(page.locator('#ad-teachers tbody tr').first().locator('.ad-msg')).toHaveText('저장했어요.');
  listFail = true;
  await page.locator('#ad-default').fill('8'); await page.locator('#ad-default').blur();
  await expect(page.locator('#ad-default-msg')).toHaveText('저장했어요.');
  await expect(page.locator('#ad-note')).toContainText('목록을 다시 불러오지 못했어요');
});

test('관리자 — supabase-js 는 정확한 버전으로 고정돼 있다', async () => {
  const fs = require('fs');
  for (const f of ['admin.html', 'teacher.html', 'sentence.html', 'auth.html', 'debug.html']) {
    const m = fs.readFileSync(__dirname + '/../' + f, 'utf8').match(/supabase-js@([^/]+)\//);
    expect(m && m[1], f).toMatch(/^\d+\.\d+\.\d+$/);
  }
});

/* ── 사용법 안내 (js/ui/tour.js) ──
 * 자동화 브라우저에서는 자동 시작이 꺼져 있다 — 다른 테스트가 안내에 가려 멈추지 않게.
 * 여기서만 window.__tour = 1 로 켠다. */
async function tourOn(context) {
  await local(context);
  await context.addInitScript(() => { window.__tour = 1; });
}
const tour = page => page.locator('.tour-box[role="dialog"]');

test('사용법 안내 — 처음 한 번만 뜨고, 다시 열지 않는다', async ({ context, page }) => {
  await tourOn(context);
  await page.goto(BASE + '/sentence.html');
  await expect(tour(page)).toBeVisible();
  await expect(tour(page)).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#tour-count')).toHaveText('1 / 3');   // 01 단계에 보이는 것만: 단계·받은 요청·사용법 보기
  await expect(page.locator('#tour-title')).toHaveText('단계');
  await expect(page.locator('.tour-btn[data-a="next"]')).toBeFocused();
  await page.locator('.tour-btn[data-a="next"]').click();
  await expect(page.locator('#tour-title')).toHaveText('받은 요청');
  await page.locator('.tour-btn[data-a="prev"]').click();
  await expect(page.locator('#tour-title')).toHaveText('단계');
  await page.locator('.tour-btn[data-a="skip"]').click();
  await expect(page.locator('.tour')).toHaveCount(0);              // 닫히면 아무것도 가리지 않는다
  await page.reload();
  await page.waitForTimeout(300);
  await expect(page.locator('.tour')).toHaveCount(0);
});

test('사용법 안내 — 다시 보기 버튼, Tab 은 안에서 돌고 Esc 로 닫으면 버튼으로 돌아온다', async ({ context, page }) => {
  await local(context);   // 자동 시작 없음
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(BASE + '/sentence.html');
  await page.waitForTimeout(300);
  await expect(page.locator('.tour')).toHaveCount(0);
  await page.locator('#tour-replay').click();
  await expect(tour(page)).toBeVisible();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('.tour-box'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tour')).toHaveCount(0);
  await expect(page.locator('#tour-replay')).toBeFocused();
});

test('사용법 안내 — 없거나 숨은 곳은 건너뛴다', async ({ context, page }) => {
  await local(context);
  await page.goto(BASE + '/sentence.html');
  await page.evaluate(() => document.querySelector('[data-tour="brief"]').removeAttribute('data-tour'));
  await page.locator('#tour-replay').click();
  await expect(page.locator('#tour-count')).toHaveText('1 / 2');   // 02~04 단계 것은 숨어 있고, 받은 요청은 없다
  await page.locator('.tour-btn[data-a="next"]').click();
  await expect(page.locator('#tour-title')).toHaveText('사용법 보기');
  await expect(page.locator('.tour-btn[data-a="next"]')).toHaveText('닫기');
  await page.locator('.tour-btn[data-a="next"]').click();
  await expect(page.locator('.tour')).toHaveCount(0);
});

test('사용법 안내 — 선생님 화면: 생성 두 방식을 밝히고, 닫으면 원래 탭으로', async ({ context, page }) => {
  await tourOn(context);
  await page.goto(BASE + '/teacher.html');
  await expect(page.locator('#tour-count')).toHaveText('1 / 8');   // 로컬 모드 — 교실 고르기는 없다
  await expect(page.locator('#tour-title')).toHaveText('학생 카드');
  const next = page.locator('.tour-btn[data-a="next"]');
  for (let i = 0; i < 4; i++) await next.click();
  await expect(page.locator('#tour-title')).toHaveText('빠른 생성');
  await expect(page.locator('#gen-btn')).toBeVisible();          // 미션 탭을 열어 실제 버튼을 밝힌다
  await next.click();
  await expect(page.locator('#tour-title')).toHaveText('개념 확인');
  await expect(page.locator('#tour-count')).toHaveText('6 / 8');   // 탭을 바꿔 앞 단계가 숨어도 전체 수는 그대로
  await expect(page.locator('#tour-text')).toContainText('개념을 확인하고, 이야기를 고른 뒤, 문제로');
  await page.keyboard.press('Escape');
  await expect(page.locator('#dtab-students')).toBeVisible();
  await page.reload();
  await page.waitForTimeout(300);
  await expect(page.locator('.tour')).toHaveCount(0);
});


/* 나침반 2차 — 선생님 서랍 카드 (2026-10-21). 서버(api/compass)는 page.route 로 가짜 */
const judgeEv = (mission_id, mid) => ({ student_id: 's1', mission_id, created_at: new Date().toISOString(), profiles: { name: '태인' }, event: { type: 's-code-judge', mid, verdict: '지켰다', basis: 'b', v: 1, t: Date.now() } });
const CK = ['N1', 'N2', 'N3', 'E1', 'E2', 'E3', 'S1', 'S2', 'S3', 'W1', 'W2', 'W3'];
const mkChecks = (oks, quotes) => Object.fromEntries(CK.map(k => [k, { ok: oks.includes(k), quote: (quotes || {})[k] || '' }]));
const cRow = (missionId, o) => Object.assign({ studentId: 's1', missionId, checks: mkChecks(['N1', 'N2', 'S1'], { N2: 'count 를 출력해 봤다' }), tutor_dirs: { N: 2, E: 0, S: 1, W: 0 },
  teacher_dir: null, teacher_note: null, sent_at: null }, o || {});
const cumOf = (rows, c) => ({ cumulative: Object.assign({ needle_deg: 18.4, dir: 'N', length: 0.7, cancel: false, candidates: [], n: rows.length }, c || {}), rows });
const cancelCum = rows => cumOf(rows, { needle_deg: null, dir: null, length: null, cancel: true, candidates: ['N', 'S'] });
async function compassTeacher(page, evs, handler) {
  const calls = [];
  await page.addInitScript(e => { window.__evs = e; }, evs);
  await page.route('**/api/compass', async r => {
    const b = r.request().postDataJSON(); calls.push(b);
    const out = await handler(b);
    return r.fulfill({ status: out.status || 200, contentType: 'application/json', body: JSON.stringify(out.json) });
  });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  return calls;
}

test('강사 — 나침반 카드: 누적 바늘 · 12칸 체크리스트 · 근거 인용 · 튜터 분포 · 보내기', async ({ page }) => {
  const sent = [];
  const calls = await compassTeacher(page, [judgeEv('M1', 'mx'),
    { ...judgeEv('M1', 'mx'), event: { type: 's-define', mid: 'mx', choice: 'a', v: 1, t: Date.now() } },
    { ...judgeEv('M1', 'mx'), event: { type: 's-redefine', mid: 'mx', to: 'b', v: 1, t: Date.now() + 1 } }], b => {
    if (b.action === 'list') return { json: { rows: [cRow('M1')] } };
    if (b.action === 'cumulative') return { json: cumOf([cRow('M1')]) };
    if (b.action === 'send') { sent.push(b); return { json: cRow('M1', { teacher_note: b.note, sent_at: '2026-10-20T00:00:00Z' }) }; }
    return { status: 500, json: { error: 'x' } };
  });
  const tile = page.locator('.student-tile', { hasText: '태인' });
  await expect(tile.locator('.tag.wait')).toHaveText('한마디 기다림');
  await tile.click();
  const card = page.locator('#detail .compass-card');
  await expect(card).toHaveCount(1);
  const sum = card.locator('.k-summary');   // 요약 카드는 머리 아래 · 기록 위, 그림과 방향이 그 안에
  await expect(sum).toHaveCount(1);
  await expect(sum.locator('.compass-dir')).toHaveText('▲ 북쪽 · 이해');
  await expect(sum.locator('h4')).toHaveText('눈에 띄는 것');
  await expect(sum.locator('.k-chip')).toHaveCount(1);
  await expect(page.locator('#detail > .k-note')).toHaveCount(1);
  const ys = await page.evaluate(() => ['.d-head', '.k-summary', '.compass-todo', '.compass-more', '.k-note', '.d-main'].map(q => document.querySelector('#detail ' + q).getBoundingClientRect().top));
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  await expect(card.locator('svg .compass-needle')).toHaveAttribute('transform', /rotate\(18\.4/);
  await expect(card.locator('svg .compass-poly')).toHaveCount(0);
  await expect(card.locator('.compass-dir')).toHaveText('▲ 북쪽 · 이해');
  await expect(card.locator('.compass-line')).toHaveText('북쪽으로 가고 있어요');
  await expect(card.locator('.compass-table tbody tr:not(.dir-head)')).toHaveCount(12);
  await expect(card.locator('.compass-table .dir-head')).toHaveText(['▲ 북쪽 · 이해', '◧ 동쪽 · 설계', '○ 남쪽 · 구현', '◇ 서쪽 · 검증']);
  await expect(card.locator('.compass-table td.yes')).toHaveCount(3);
  await expect(card.locator('.compass-table td.no')).toHaveCount(9);
  await expect(card.locator('.compass-table td .q')).toHaveText(['“count 를 출력해 봤다”']);
  await expect(card.locator('.compass-tutor')).toContainText('▲ 이해 2번 · ◧ 설계 0번 · ○ 구현 1번 · ◇ 검증 0번');
  // 두드러지는 것 — 바늘 아래 사실 몇 줄, 12칸 표는 접혀 있다
  await expect(card.locator('.compass-gist > li', { hasText: '예가 가장 많은 쪽' })).toContainText('▲ 북쪽 · 이해');
  await expect(card.locator('.compass-gist > li', { hasText: '예가 가장 적은 쪽' })).toContainText('◧ 동쪽 · 설계, ◇ 서쪽 · 검증');
  await expect(card.locator('.compass-gist .q')).toHaveText(['“count 를 출력해 봤다”']);
  await expect(card.locator('.compass-table')).toBeHidden();
  await card.locator('.compass-more summary').click();
  await expect(card.locator('.compass-table')).toBeVisible();
  await expect(card.locator('select')).toHaveCount(0);
  await expect(card.locator('.compass-cand')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 800 });   // 휴대폰 — 표는 칸 안에서만 옆으로 밀고, 페이지는 안 민다
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(card.getByLabel('한마디 — 학생에게 그대로 보여요.')).toBeVisible();
  for (const sel of ['.compass-send', '.compass-reread']) expect((await card.locator(sel).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await card.locator('.compass-send').click();
  await expect(card.locator('.compass-msg')).toHaveText('한마디를 적어 주세요.');
  expect(calls.filter(c => c.action === 'send')).toHaveLength(0);
  await card.getByLabel('한마디 — 학생에게 그대로 보여요.').fill('설계를 고친 게 좋았어요.');
  await card.locator('.compass-send').click();
  await expect(card.locator('.compass-sent')).toContainText('보냈어요');
  await expect(card.locator('.compass-sent-note')).toHaveText('설계를 고친 게 좋았어요.');
  await page.locator('#detail-back').click();
  await expect(tile.locator('.tag.wait')).toHaveCount(0);   // 보낸 뒤 명단 꼬리표가 사라진다
  await tile.click();
  expect(sent).toEqual([{ classroomId: 'r1', studentId: 's1', missionId: 'M1', note: '설계를 고친 게 좋았어요.', action: 'send' }]);   // 안 지워졌으면 dir 를 싣지 않는다
  await card.getByLabel('한마디 — 학생에게 그대로 보여요.').fill('고쳐 다시 보내요.');   // 고쳐 다시 보낼 수 있다
  await card.locator('.compass-send').click();
  await expect(card.locator('.compass-sent-note')).toHaveText('고쳐 다시 보내요.');
  await card.locator('.compass-reread').click();
  await expect.poll(() => calls.filter(c => c.action === 'analyze' && c.force === true).length).toBe(1);
});

test('강사 — 짧은 바늘은 고르게, 지워지면 바늘 없이 후보만 · 고른 방향은 가장 최근 미션에만 실린다', async ({ page }) => {
  let cancel = true; const sent = [];
  const calls = await compassTeacher(page, [judgeEv('M1', 'mx'), judgeEv('M2', 'my')], b => {
    if (b.action === 'list') return { json: { rows: [cRow('M1'), cRow('M2')] } };
    if (b.action === 'cumulative') return { json: cancel ? cancelCum([cRow('M2'), cRow('M1')]) : cumOf([cRow('M2'), cRow('M1')], { dir: 'N', needle_deg: 0, length: 0.25 }) };
    if (b.action === 'send') { sent.push(b); if (b.dir) cancel = false; return { json: cRow(b.missionId, { teacher_note: b.note, sent_at: 'x' }) }; }
    return { status: 500, json: { error: 'x' } };
  });
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const card = page.locator('#detail .compass-card');
  await expect(card.locator('.compass-cand')).toHaveText(['▲ 북쪽 · 이해', '○ 남쪽 · 구현']);   // 겹친 후보만
  await expect(card.locator('svg .compass-needle')).toHaveCount(0);
  await expect(card.locator('.compass-line')).toHaveCount(0);
  await expect(card).toContainText('어느 쪽이 더 보였는지 골라 주세요');
  await expect(card.locator('.k-summary svg .compass-needle')).toHaveCount(0);
  await expect(card.locator('.compass-todo .compass-cand')).toHaveCount(2);   // 후보 고르기는 할 일 칸에
  await card.locator('.compass-more > summary').click();
  await expect(card.locator('.compass-more')).toHaveAttribute('open', '');
  await expect(card.locator('.compass-table th[scope="col"]')).toHaveCount(2);
  await card.locator('.compass-cand', { hasText: '북쪽' }).click();
  await expect(card.locator('.compass-cand', { hasText: '북쪽' })).toHaveAttribute('aria-pressed', 'true');
  const forms = card.locator('.compass-form');
  await expect(forms).toHaveCount(2);
  await forms.nth(0).locator('textarea').fill('이전 미션 한마디');   // M1 — 가장 최근이 아니다
  await forms.nth(0).locator('.compass-send').click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].missionId).toBe('M1');
  expect('dir' in sent[0]).toBe(false);
  await expect(forms.nth(0).locator('.compass-sent')).toBeVisible();   // 첫 보내기의 다시 그리기가 끝난 뒤에 둘째 칸을 쓴다
  await expect(card.locator('.compass-cand', { hasText: '북쪽' })).toHaveAttribute('aria-pressed', 'true');   // 고른 것이 남아 있다
  await expect(card.locator('.compass-more')).toHaveAttribute('open', '');   // 펼친 상태도 다시 그려도 남는다
  await card.locator('.compass-form').nth(1).locator('textarea').fill('이번 미션 한마디');
  await card.locator('.compass-form').nth(1).locator('.compass-send').click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].missionId).toBe('M2');
  expect(sent[1].dir).toBe('N');
  await expect(card.locator('svg .compass-needle')).toHaveCount(1);   // 다시 계산해 바늘이 돌아온다
  await expect(card.locator('.compass-cand')).toHaveCount(0);
  await expect(card.locator('.compass-line')).toHaveText('북쪽으로 가고 있어요 · 고르게 가고 있어요');
});

test('강사 — 쓰던 한마디는 다시 그려도 남고, 후보가 바뀌면 옛 선택은 실리지 않는다', async ({ page }) => {
  let mode = 'NS'; const sent = [];
  const calls = await compassTeacher(page, [judgeEv('M1', 'mx'), judgeEv('M2', 'my')], b => {
    if (b.action === 'list') return { json: { rows: [cRow('M1'), cRow('M2')] } };
    if (b.action === 'cumulative') return { json: cumOf([cRow('M2'), cRow('M1')], { needle_deg: null, dir: null, length: null, cancel: true, candidates: mode === 'NS' ? ['N', 'S'] : ['E', 'W'] }) };
    if (b.action === 'send') { sent.push(b); return { json: cRow(b.missionId, { teacher_note: b.note, sent_at: 'x' }) }; }
    return { status: 500, json: { error: 'x' } };
  });
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const card = page.locator('#detail .compass-card');
  const forms = card.locator('.compass-form');
  await expect(forms).toHaveCount(2);
  await card.locator('.compass-cand', { hasText: '북쪽' }).click();
  await forms.nth(1).locator('textarea').fill('쓰던 중인 말');
  await forms.nth(0).locator('textarea').fill('다른 칸');
  await forms.nth(0).locator('.compass-send').click();               // 한 칸을 보내면 카드 전체가 다시 그려진다
  await expect(forms.nth(0).locator('.compass-sent')).toBeVisible();
  await expect(forms.nth(1).locator('textarea')).toHaveValue('쓰던 중인 말');
  mode = 'EW';
  await page.locator('#detail-back').click();                          // 다시 열면 누적을 새로 받는다
  await page.locator('.student-tile', { hasText: '태인' }).click();
  await expect(card.locator('.compass-cand')).toHaveText(['◧ 동쪽 · 설계', '◇ 서쪽 · 검증']);
  await expect(card.locator('.compass-form').nth(1).locator('textarea')).toHaveValue('쓰던 중인 말');   // 초안은 세션 동안 남는다
  await card.locator('.compass-form').nth(1).locator('.compass-send').click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].missionId).toBe('M2');
  expect('dir' in sent[1]).toBe(false);                                // 옛 선택(북)은 후보에 없으니 싣지 않는다
  await expect(card.locator('.compass-form').nth(1).locator('textarea')).toHaveValue('쓰던 중인 말');   // 보낸 뒤엔 보낸 말(= 같은 말)
});

test('강사 — 보내기가 실패하면 안내가 남고, 버튼은 다시 눌리고, 쓴 말은 그대로다', async ({ page }) => {
  let fail = true; const sent = [];
  await compassTeacher(page, [judgeEv('M1', 'mx')], b => {
    if (b.action === 'list') return { json: { rows: [cRow('M1')] } };
    if (b.action === 'cumulative') return { json: cumOf([cRow('M1')]) };
    if (b.action === 'send') { sent.push(b); return fail ? { status: 502, json: { error: 'x' } } : { json: cRow('M1', { teacher_note: b.note, sent_at: 'x' }) }; }
    return { status: 500, json: { error: 'x' } };
  });
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const card = page.locator('#detail .compass-card');
  await card.locator('textarea').fill('꼭 전하고 싶은 말');
  await card.locator('.compass-send').click();
  await expect(card.locator('.compass-msg')).toHaveText('지금은 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  await page.waitForTimeout(300);                                   // 뒤따르는 다시 그리기를 지나도
  await expect(card.locator('.compass-msg')).toHaveText('지금은 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  await expect(card.locator('.compass-send')).toBeEnabled();
  await expect(card.locator('textarea')).toHaveValue('꼭 전하고 싶은 말');
  fail = false;
  await card.locator('.compass-send').click();
  await expect(card.locator('.compass-sent-note')).toHaveText('꼭 전하고 싶은 말');
  await expect(card.locator('.compass-msg')).toHaveText('');
  expect(sent).toHaveLength(2);
});

test('강사 — 바늘이 지워지면 칭찬 타이밍 알림 한 번, 열 때 이미 지워져 있던 것은 알리지 않는다', async ({ page }) => {
  test.setTimeout(60000);
  let two = false;
  const calls = await compassTeacher(page, [judgeEv('M1', 'mx')], b => {
    if (b.action === 'list') return { json: { rows: [cRow('M1')] } };
    if (b.action === 'analyze') return { json: cRow(b.missionId) };
    if (b.action === 'cumulative') return { json: two ? cancelCum([cRow('M2'), cRow('M1')]) : cancelCum([cRow('M1')]) };   // 처음부터 지워져 있었다
    return { status: 500, json: { error: 'x' } };
  });
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await expect.poll(() => calls.filter(c => c.action === 'cumulative').length).toBeGreaterThan(0);
  await page.waitForTimeout(3500);
  await expect(page.locator('#alert-list li')).toHaveCount(0);   // 기준선 — 열 때 있던 일
  two = true;
  await page.evaluate(e => { window.__evs.push(e); }, judgeEv('M2', 'my'));
  const cancelLi = page.locator('#alert-list li', { hasText: '이해와 구현이 같이 두드러져요' });
  await expect(cancelLi).toHaveCount(1, { timeout: 10000 });
  await expect(cancelLi).toContainText('태인이 최근 미션에서 이해와 구현이 같이 두드러져요. 어느 쪽이 더 보였는지 골라 주세요.');
  await expect(cancelLi).toHaveAttribute('data-tag', 'praise');
  await page.waitForTimeout(3500);
  await expect(cancelLi).toHaveCount(1);   // 폴링을 거듭해도 한 번
  await cancelLi.locator('.al-it').click();
  const landed = await page.evaluate(() => document.activeElement === document.querySelector('#detail .compass-card'));
  expect(landed).toBe(true);
  await expect(page.locator('#detail details.k-fold[open]')).toHaveCount(1);   // 알림이 가리킨 미션 줄만 열려 있다
  await expect(page.locator('#detail .compass-form')).toHaveCount(1);          // 한마디 칸도 그 미션 것만
});

test('강사 — 열 때 끝난 미션은 알림 없이 하나씩 차례로 읽고, 실패하면 한마디 칸에 다시 읽기', async ({ page }) => {
  let running = 0, maxRun = 0;
  const calls = await compassTeacher(page, [judgeEv('M1', 'mx'), judgeEv('M2', 'my'), judgeEv('M3', 'mz')], async b => {
    if (b.action === 'list') return { json: { rows: [cRow('M1', { sent_at: 'x', teacher_note: 'ok' })] } };
    running++; maxRun = Math.max(maxRun, running);
    await new Promise(r => setTimeout(r, 150));
    running--;
    if (b.action === 'cumulative') return { json: cumOf([cRow('M1')]) };
    return b.missionId === 'M3' ? { status: 502, json: { error: '지금은 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.' } } : { json: cRow(b.missionId) };
  });
  const tile = page.locator('.student-tile', { hasText: '태인' });
  await expect(tile.locator('.tag.wait')).toHaveText('한마디 기다림');
  await expect.poll(() => calls.filter(c => c.action === 'analyze').length).toBe(2);
  expect(calls.filter(c => c.action === 'analyze').map(c => c.missionId)).toEqual(['M2', 'M3']);
  expect(maxRun).toBe(1);
  await expect(page.locator('#toasts .toast')).toHaveCount(0);
  await expect(page.locator('#alert-list li')).toHaveCount(0);
  await tile.click();
  const cards = page.locator('#detail .compass-card');
  await expect(cards).toHaveCount(1);
  const forms = cards.locator('.compass-form');
  await expect(forms).toHaveCount(3);
  await expect(forms.nth(2)).toContainText('지금은 읽지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  await expect(forms.nth(2).locator('.compass-reread')).toBeVisible();
  const cw = (await cards.first().boundingBox()).width, dw = (await page.locator('#detail').boundingBox()).width;
  expect(cw).toBeGreaterThan(dw - 4);                          // 나침반 카드는 본문 폭 전체
  await page.locator('#detail-back').click();
  await expect(tile.locator('.tag.wait')).toBeVisible();   // 실패해도 표시는 남는다
});

test('강사 — 로컬 모드는 /api/compass 를 부르지 않고 나침반 카드도 없다', async ({ page }) => {
  let n = 0;
  await page.route('**/supabase-js@*/**', r => r.abort());
  await page.route('**/api/compass', r => { n++; r.abort(); });
  await page.goto(BASE + '/teacher.html');
  await page.waitForTimeout(500);
  expect(n).toBe(0);
  expect(await page.locator('.compass-card').count()).toBe(0);
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.locator('.student-tile').first().click();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail .compass-card')).toHaveCount(0);   // 서버가 없으면 나침반은 없고 요약만
  await expect(page.locator('#detail .k-summary')).toHaveCount(1);
  expect(errs).toEqual([]);
});

test('강사 — list 가 실패하면 폴링마다 다시 부르지 않고 다시 읽기에서만 다시 부른다', async ({ page }) => {
  let ok = false;
  const calls = await compassTeacher(page, [judgeEv('M1', 'mx')], b => !ok ? { status: 502, json: { error: 'x' } } : b.action === 'cumulative' ? { json: cumOf([cRow('M1')]) } : { json: { rows: [cRow('M1')] } });
  await expect.poll(() => calls.length).toBe(1);
  await page.evaluate(() => CC._compassSync('r1')); await page.evaluate(() => CC._compassSync('r1'));
  await page.waitForTimeout(300);
  expect(calls.length).toBe(1);
  await page.locator('.student-tile', { hasText: '태인' }).click();
  await expect(page.locator('#detail .compass-card')).toContainText('지금은 읽지 못했어요');
  ok = true;
  await page.locator('#detail .compass-reread').first().click();
  await expect(page.locator('#detail .compass-send')).toBeVisible();
  expect(calls.filter(c => c.action === 'list')).toHaveLength(2);   // 다시 읽기는 목록을 딱 한 번 더 부른다
});

/* 나침반 2차 — 학생. "내 기록" 탭에 누적 나침반 하나, 미션 카드에는 선생님 한마디만 */
async function studentCompass(page, o) {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(r => { Object.assign(window, r); }, o);
  await asStudent(page);
  await page.locator('.room-tile').first().click();
  await page.locator('.mission-file').first().click();
  return errs;
}

test('학생 — 내 기록 탭의 누적 나침반: 바늘(길이) · ○쪽으로 가고 있어요, 점수·체크는 없다', async ({ page }) => {
  const errs = await studentCompass(page, { __compass: { needle_deg: 100, dir: 'E', length: 0.8, sent_at: 't', levels: { N: 3 }, checks: { N1: 1 } } });
  await page.locator('.main-tab[data-panel="panel-history"]').click();
  const card = page.locator('#compass-cum');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText('내 나침반');
  await expect(card.locator('svg .compass-needle')).toHaveAttribute('transform', /rotate\(100/);
  await expect(card.locator('svg')).toHaveAttribute('aria-label', '동쪽 · 설계');
  await expect(card.locator('.compass-dir')).toHaveText('동쪽으로 가고 있어요');
  await expect(card.locator('.compass-even')).toHaveCount(0);
  const html = await page.content();
  for (const w of ['3단계', 'levels', 'checks', 'N1']) expect(html).not.toContain(w);
  expect(errs).toEqual([]);
});

test('학생 — 바늘이 짧으면(0.3 이하) 고르게 가고 있어요가 덧붙는다', async ({ page }) => {
  await studentCompass(page, { __compass: { needle_deg: 10, dir: 'N', length: 0.25, sent_at: 't' } });
  await page.locator('.main-tab[data-panel="panel-history"]').click();
  await expect(page.locator('#compass-cum .compass-dir')).toHaveText('북쪽으로 가고 있어요');
  await expect(page.locator('#compass-cum .compass-even')).toHaveText('고르게 가고 있어요');
});

test('학생 — 보낸 적 없으면(0행) 기다리는 말, 바늘은 없다', async ({ page }) => {
  await studentCompass(page, { __compass: null });
  await page.locator('.main-tab[data-panel="panel-history"]').click();
  const card = page.locator('#compass-cum');
  await expect(card).toContainText('선생님이 곧 방향을 알려 주실 거예요.');
  await expect(card.locator('svg')).toHaveCount(0);
});

test('학생 — 호출이 실패하면 나침반 카드가 없고 에러도 없다', async ({ page }) => {
  const errs = await studentCompass(page, { __compass: 'throw', __note: 'throw' });
  await page.locator('.main-tab[data-panel="panel-history"]').click();
  await expect(page.locator('#compass-cum')).toBeHidden();
  await expect(page.locator('#compass-mine')).toBeHidden();
  expect(errs).toEqual([]);
});

/* 운영 보고(2026-10-22): 로그인하고 바로 내 기록을 누르면 마친 미션이 있어도 "아직 기록이 없어요" — 지금 연 미션 하나만 그렸다 */
test('학생 — 미션을 열지 않고 내 기록을 눌러도 지난 미션 카드와 선생님 한마디가 보인다', async ({ page }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { window.__note = { teacher_note: '쪼갠 순서를 말로 설명했어요', sent_at: 't' }; });
  await asStudent(page, [{ id: 'r1', name: '1학년 3반' }]);
  await page.locator('.main-tab[data-panel="panel-history"]').click();
  const cards = page.locator('#history-list .record-card');
  await expect(cards).toHaveCount(2);                       // 푼 미션 · 하던 미션. 안 연 미션 · 진단은 카드가 없다
  await expect(cards.nth(0)).toContainText('푼 미션');
  await expect(cards.nth(0)).toContainText('끝');
  await expect(cards.nth(0).locator('.rc-note')).toContainText('쪼갠 순서를 말로 설명했어요');
  await expect(cards.nth(1)).toContainText('하던 미션');
  await expect(page.locator('#history-empty')).toBeHidden();
  await expect(page.locator('#compass-cum')).toBeVisible();
  expect(errs).toEqual([]);
});

test('학생 — 기록도 나침반도 없으면 빈 안내 둘이 보인다', async ({ page }) => {
  await page.addInitScript(() => { window.__evs = []; window.__compass = null; });
  await asStudent(page);
  await page.locator('.main-tab[data-panel="panel-history"]').click();
  await expect(page.locator('#compass-cum')).toContainText('선생님이 곧 방향을 알려 주실 거예요.');
  await expect(page.locator('#history-empty')).toHaveText('아직 기록이 없어요. 미션을 풀면 여기에 남아요.');
  await expect(page.locator('#history-list .record-card')).toHaveCount(0);
});

test('학생 — 미션 카드에는 선생님 한마디만, 바늘도 방향도 없다', async ({ page }) => {
  await studentCompass(page, { __note: { teacher_note: '첫 줄\n둘째 줄 <b>x</b>', sent_at: 't', needle_deg: 18, dir: 'N' } });
  const card = page.locator('#compass-mine');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText('선생님 한마디');
  await expect(card.locator('.compass-note')).toHaveText('첫 줄\n둘째 줄 <b>x</b>');
  expect(await card.locator('.compass-note').evaluate(e => getComputedStyle(e).whiteSpace)).toBe('pre-wrap');
  await expect(card.locator('svg')).toHaveCount(0);
  await expect(card.locator('.compass-dir')).toHaveCount(0);
  expect(await page.evaluate(() => window.__cn)).toEqual(['db1']);
});

test('학생 — 한마디를 안 받았으면 미션 카드가 없다', async ({ page }) => {
  await studentCompass(page, { __note: null });
  await expect(page.locator('#step1')).toBeVisible();
  await expect(page.locator('#compass-mine')).toBeHidden();
});

test('학생 — 로컬 모드는 나침반을 부르지 않고 카드도 없다', async ({ page }) => {
  await local(page.context());
  await seedMission(page);
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await expect(page.locator('#compass-mine')).toBeHidden();
  await expect(page.locator('#compass-cum')).toBeHidden();
});

/* ── 선생님 화면 틀 (2026-10-20 시안) — 왼쪽 사이드바 · 한 열 본문 · 오른쪽 알림 ── */
test('선생님 틀 — 왼쪽에 교실과 메뉴, 고른 교실 아래 학생·미션·학생 추가, 아래 관리자·설계 의도·로그아웃', async ({ page }) => {
  await asTeacher(page);
  const side = page.locator('#side');
  await expect(side).toHaveAttribute('aria-label', '교실과 메뉴');
  await expect(side.locator('#classroom-cards .room-tile')).toHaveCount(2);
  await side.locator('.room-tile', { hasText: '태인한결' }).click();
  const tabs = side.locator('.main-tab[data-dtab]');
  await expect(tabs).toHaveText(['학생', '미션', '학생 추가']);
  await expect(tabs.first()).toHaveAttribute('aria-current', 'page');   // 처음부터 지금 보기를 밝힌다
  const room = await side.locator('.room-tile', { hasText: '태인한결' }).boundingBox();
  const next = await side.locator('.room-tile', { hasText: '방과후' }).boundingBox();
  const t0 = await tabs.first().boundingBox();
  expect(t0.y).toBeGreaterThan(room.y);                   // 고른 교실 바로 아래
  expect(t0.y).toBeLessThan(next.y);
  await expect(side.locator('#t-admin')).toBeVisible();
  await expect(side.locator('#notes-toggle')).toBeVisible();
  await expect(side.locator('#tour-replay')).toBeVisible();
  await expect(side.locator('#t-logout')).toContainText('김선생');
  await expect(page.locator('#dashboard')).not.toContainText('말 걸 순간');   // 본문에서는 없앴다 — 오른쪽 알림으로
  await expect(page.locator('#alerts')).toBeVisible();
  await expect(page.locator('#alerts #alert-list')).toBeAttached();
  await expect(page.locator('#alerts #moments-empty')).toBeVisible();

  await side.getByRole('button', { name: '새 교실 만들기' }).click();
  await expect(page.locator('#new-room-name')).toBeVisible();
  await expect(page.locator('#dashboard')).toBeHidden();
  await expect(page.locator('#alerts')).toBeHidden();      // 새 교실 화면에는 오른쪽 패널이 없다
  await side.locator('.room-tile', { hasText: '방과후' }).click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#dash-title')).toHaveText('방과후');
  await side.locator('.main-tab[data-dtab="dtab-invite"]').click();
  await expect(page.locator('#dtab-invite')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('선생님 틀 — 접으면 72px 아이콘 줄, 새로고침해도 접힌 채, Tab 으로 메뉴 전부 · 포커스가 보인다', async ({ page }) => {
  await asTeacher(page);
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  const tg = page.locator('#side-toggle');
  await expect(tg).toHaveAttribute('aria-expanded', 'true');
  await expect(tg).toHaveAttribute('aria-controls', 'side');
  await tg.click();
  await expect(tg).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => Math.round((await page.locator('#side').boundingBox()).width)).toBe(72);
  await page.reload();
  await expect(page.locator('#side-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(Math.round((await page.locator('#side').boundingBox()).width)).toBe(72);
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  const side = page.locator('#side');
  for (const name of ['학생', '미션', '학생 추가', '새 교실 만들기', '관리자', '사용법 보기', '설계 의도']) {
    const it = side.getByRole(name === '관리자' ? 'link' : 'button', { name, exact: true });
    await expect(it).toBeVisible();                                  // 글자는 숨어도 이름은 남는다
    await expect(it).toHaveAttribute('title', name);                 // 마우스를 올리면 이름이 뜬다
  }
  await page.locator('#side-toggle').focus();
  const seen = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a.closest('#side')) return null;
      const r = a.getBoundingClientRect(), cs = getComputedStyle(a);
      return { id: a.id || a.dataset.dtab || a.textContent.trim(), w: r.width, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
    }));
  }
  const ids = seen.filter(Boolean).map(s => s.id);
  for (const want of ['dtab-students', 'dtab-missions', 'dtab-invite', 't-admin', 'tour-replay', 'notes-toggle', 't-logout']) expect(ids).toContain(want);
  expect(ids.filter(x => /태인한결|방과후/.test(x))).toHaveLength(2);
  for (const s of seen.filter(Boolean)) { expect(s.outline).toBe(true); expect(s.w).toBeLessThanOrEqual(72); }

  await page.locator('#side-toggle').click();               // 다시 펼치면 264px
  await expect.poll(async () => Math.round((await page.locator('#side').boundingBox()).width)).toBe(264);
});

const alEv = (sid, name, e) => ({ student_id: sid, created_at: new Date().toISOString(), profiles: { name }, event: Object.assign({ v: 1, t: Date.now() }, e) });
test('선생님 알림 — 이름표 · 문장 · 시각, 누르면 학생 상세, 읽으면 보통 글씨, 고르기, 폴링 두 번에도 한 번', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await expect(page.locator('#alerts h2')).toHaveText('알림');
  await expect(page.locator('#alerts')).toContainText('점수가 아니라 타이밍이에요. 말은 선생님이 해 주세요.');
  await expect(page.locator('#alert-list li')).toHaveCount(0);   // 연 뒤에 생긴 것만
  await page.evaluate((add) => { window.__evs.push(...add); }, [
    alEv('s1', '태인', { type: 's-redefine', mid: 'mx' }),
    ...[1, 2, 3, 4, 5].map(i => alEv('s1', '태인', { type: 's-tutor', mid: 'mx', q: 'q' + i, a: 'a' })),
    alEv('s3', '한결', { type: 's-onboard', answers: [], skipped: false })
  ]);
  const items = page.locator('#alert-list li');
  await expect(items).toHaveCount(3, { timeout: 8000 });
  await expect(page.locator('.toast').first()).toBeVisible();     // 토스트는 그대로
  const tags = (await items.locator('.al-tag').allInnerTexts()).sort();
  expect(tags).toEqual(['레벨 테스트', '살펴볼 것', '칭찬 타이밍']);
  const praise = items.filter({ hasText: '칭찬 타이밍' });
  await expect(praise).toContainText('태인이 성공 조건을 스스로 바꿨어요.');
  await expect(praise.locator('time')).toHaveText('방금');
  await noPraise(page);
  await expect(praise.locator('.al-it')).toContainText('새 알림');              // 안 읽음은 낭독기에도

  await page.waitForTimeout(10500);                                 // 5초 폴링 두 번
  await expect(items).toHaveCount(3);

  for (const [tag, n] of [['praise', 1], ['look', 1], ['all', 3]]) {
    await page.locator(`.al-filter[data-tag="${tag}"]`).click();
    await expect(page.locator(`.al-filter[data-tag="${tag}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(items.filter({ visible: true })).toHaveCount(n);
  }
  const say = praise.locator('.al-say');
  expect(Number(await say.evaluate(e => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
  await praise.locator('.al-it').click();
  await expect(praise.locator('.al-it')).not.toContainText('새 알림');
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail')).toContainText('태인');
  await page.keyboard.press('Escape');
  expect(Number(await say.evaluate(e => getComputedStyle(e).fontWeight))).toBeLessThan(600);

  const at = page.locator('#alerts-toggle');                        // 접으면 노란 손잡이, 새로고침해도 접힌 채
  await expect(at).toHaveAttribute('aria-expanded', 'true');
  await at.click();
  await expect(page.locator('#alert-list')).toBeHidden();
  await expect(page.getByRole('button', { name: '알림 펼치기' })).toBeVisible();
  await page.reload();
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('#alert-list')).toBeHidden();
  await page.getByRole('button', { name: '알림 펼치기' }).click();
  await expect(page.locator('#alert-list')).toBeAttached();
  await expect(page.locator('#alerts-toggle')).toBeVisible();
});

test('선생님 틀 — 390 폭: ☰ 로 사이드바, 아래 알림 막대는 전체 화면 알림, 가로 스크롤 없음', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  const side = page.locator('#side');
  await expect(side).toBeHidden();
  const open = page.locator('#side-open');
  await expect(open).toBeVisible();
  expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await open.click();
  await expect(side).toBeVisible();
  const inside = async (sel, n) => {                                // 열린 겹 밖으로 Tab 이 새지 않는다
    for (let i = 0; i < n; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(s => !!document.activeElement.closest(s), sel)).toBe(true);
    }
  };
  await inside('#side', 12);
  await page.keyboard.press('Escape');
  await expect(side).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await side.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(side).toBeHidden();                                  // 교실을 고르면 닫힌다
  await expect(page.locator('#alerts')).toBeHidden();
  const bar = page.locator('#alerts-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('알림');
  await page.evaluate((e) => { window.__evs.push(e); }, alEv('s1', '태인', { type: 's-redefine', mid: 'mx' }));
  await expect(bar).toContainText('칭찬 타이밍 1개', { timeout: 8000 });
  await bar.click();
  const al = page.locator('#alerts');
  await expect(al).toBeVisible();
  const box = await al.boundingBox();
  expect(Math.round(box.width)).toBe(390);
  await expect(al.locator('#alert-list li')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await inside('#alerts', 8);
  await page.keyboard.press('Escape');                              // Esc 로 닫으면 막대로 돌아온다
  await expect(al).toBeHidden();
  await expect(bar).toBeFocused();
  await bar.click();
  await al.locator('#alert-list li .al-it').click();                // 누르면 알림 화면을 닫고 학생 상세
  await expect(al).toBeHidden();
  await expect(page.locator('#detail')).toBeVisible();
  await page.evaluate(() => document.querySelector('#side-open').click());   // 상세 위에 서랍을 열면 Esc 는 서랍부터
  await expect(side).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(side).toBeHidden();
  await expect(page.locator('#detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail')).toBeHidden();
  await open.click();
  await page.locator('#side-scrim').click({ position: { x: 380, y: 400 } });
  await expect(side).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('선생님 알림 — 30개를 넘기면 읽은 것부터 버리고 안 읽은 알림은 남긴다', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  const items = page.locator('#alert-list li');
  await page.evaluate((e) => { window.__evs.push(e); }, alEv('s1', '태인', { type: 's-redefine', mid: 'm-old' }));
  await expect(items).toHaveCount(1, { timeout: 8000 });
  await page.evaluate((e) => { window.__evs.push(e); }, alEv('s1', '태인', { type: 's-redefine', mid: 'm-read' }));
  await expect(items).toHaveCount(2, { timeout: 8000 });
  await items.first().locator('.al-it').click();                    // 새것을 읽고, 가장 오래된 것은 안 읽은 채로
  await page.keyboard.press('Escape');
  await page.evaluate((add) => { window.__evs.push(...add); }, Array.from({ length: 29 }, (_, i) => alEv('s1', '태인', { type: 's-redefine', mid: 'm' + i })));
  await expect(page.locator('#alert-list li.new')).toHaveCount(30, { timeout: 8000 });
  await expect(items).toHaveCount(30);
});

test('학생 상세 — 본문 화면: 목록은 숨고, ← 학생 · Esc 로 돌아오면 스크롤과 타일 포커스가 남는다', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await page.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 240); });
  const tile = page.locator('.student-tile', { hasText: '태인' });
  await tile.click();
  const d = page.locator('#detail');
  await expect(d).toBeVisible();
  await expect(page.locator('#scrim')).toHaveCount(0);
  await expect(page.locator('#student-folders')).toBeHidden();
  await expect(page.locator('#alerts')).toBeVisible();                       // 알림은 상세에서도 곁에
  await expect(d.locator('#detail-back')).toHaveText('← 학생');
  expect(await d.evaluate(el => getComputedStyle(el).position)).not.toBe('fixed');
  const order = await d.evaluate(el => ['.d-head', '.k-summary', '.k-note', '.d-main', '.d-tutor'].map(q => (el.querySelector(q) || {}).offsetTop));
  expect(order.every(n => typeof n === 'number')).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await expect(d.locator('.d-tutor')).toContainText('튜터 대화 · 짚을 거리');
  await d.locator('#detail-back').click();
  await expect(d).toBeHidden();
  await expect(page.locator('#student-folders')).toBeVisible();
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(240);
  await expect(tile).toBeFocused();
  await tile.click();
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(tile).toBeFocused();
});

test('학생 상세 — 알림 항목으로 열면 그 미션 줄만 열려 있다', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await page.evaluate((add) => { window.__evs.push(...add); }, [
    alEv('s1', '태인', { type: 's-define', mid: 'my', choice: 'x' }),
    alEv('s1', '태인', { type: 's-redefine', mid: 'mx' })
  ]);
  const praise = page.locator('#alert-list li', { hasText: '칭찬 타이밍' });
  await expect(praise).toHaveCount(1, { timeout: 8000 });
  await praise.locator('.al-it').click();
  const d = page.locator('#detail');
  await expect(d.locator('details.k-fold')).toHaveCount(2);
  await expect(d.locator('details.k-fold[open]')).toHaveCount(1);   // 그 미션 줄만 열려 있다
  await expect(d.locator('details.k-fold[open] > summary')).toContainText('미션 2');   // 알림이 가리킨 mx 는 기록에 두 번째로 나온 미션
  await expect(d.locator('.mf')).toHaveCount(0);
});

test('학생 상세 — 미션마다 접는 줄 하나, 가장 최근 미션이 위, 알약은 없다', async ({ page }) => {
  const calls = await asRecapTeacher(page, RECAP_EVS, { contentType: 'application/json', body: '{}' });
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const d = page.locator('#detail');
  await expect(d.locator('.mf')).toHaveCount(0);
  const folds = d.locator('details.k-fold');
  await expect(folds).toHaveCount(2);                                 // ma · mb (예전 기록 없음)
  await expect(folds.first().locator('summary')).toContainText('미션 2');   // mb 가 가장 최근
  await expect(folds.nth(1).locator('summary')).toHaveText('미션 1 · 완료');   // 기록의 사실 — 끝냈다
  await expect(folds.first().locator('summary')).toHaveText('미션 2 · 아직');
  await expect(d.locator('details.k-fold[open]')).toHaveCount(0);     // 둘 이상이면 모두 접힌 채
  await folds.nth(1).locator('summary').click();
  await expect(folds.nth(1).locator('.d-step-h')).toHaveText(['02 성공', '05 정리']);
  expect(calls.length).toBe(0);
});

/* 미션 만들기 — 탭 둘과 4단계 (2026-10-20) */
async function missionTab(page, quota) {
  await page.route('**/api/mission-steps', async r => {
    const b = r.request().postDataJSON();
    if (b.action === 'quota') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(quota || { left: 3, disabled: false }) });
    if (b.action === 'concept') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ concept: 'for', label: '반복문 for', by: 'keyword' }) });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ examples: [{ title: '영수증', situation: '영수증을 모아요.', why: '하나씩 더해요' }] }) });
  });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
}

test('미션 만들기 — 탭 둘(화살표 키 · 기억)과 단계별 4단계, 끝난 단계는 한 줄로 접히고 고치기로 돌아간다', async ({ page }) => {
  await missionTab(page);
  const tabs = page.locator('#dtab-missions [role=tablist] [role=tab]');
  await expect(tabs).toHaveText(['단계별로 만들기', '한 번에 만들기']);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#gp-step')).toBeVisible();
  await expect(page.locator('#gp-quick')).toBeHidden();
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(page.locator('#gp-quick')).toBeVisible();
  await expect(page.locator('#gen-btn')).toBeVisible();
  await expect(page.locator('#gp-quick .gp-quota')).toContainText('만들기를 누르면 1개를 써요');
  await page.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press('End');
  await page.reload();
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');    // 마지막에 고른 탭을 기억한다
  await tabs.first().click();
  await expect(page.locator('#gp-count')).toHaveText('1 / 4 수업 내용');
  await expect(page.locator('.gp-bar i.on')).toHaveCount(1);
  await expect(page.locator('#gp-step .gp-s:visible')).toHaveCount(1);
  await expect(page.locator('.gp-s[data-step="1"] .gp-quota')).toContainText('여기까지는 횟수를 쓰지 않아요');
  await expect(page.locator('.gp-s[data-step="1"] .gen-left')).toHaveText('남은 생성 3개');
  await page.locator('#gen-lesson').fill('리스트와 반복문');
  await page.locator('#sg-concept').click();
  await expect(page.locator('#gp-count')).toHaveText('2 / 4 개념 확인');
  await expect(page.locator('.gp-s[data-step="1"] .gp-sum')).toContainText('리스트와 반복문');
  await expect(page.locator('#gen-lesson')).toBeHidden();
  await page.locator('#sg-next').click();
  await expect(page.locator('#gp-count')).toHaveText('3 / 4 이야기 고르기');
  await expect(page.locator('.gp-bar i.on')).toHaveCount(3);
  await expect(page.locator('.gp-s[data-step="3"] .gp-quota')).toContainText('문제 만들기를 누르면 1개를 써요');
  await expect(page.locator('#sg-build')).toHaveText('문제 만들기');
  await page.locator('.gp-s[data-step="1"] .gp-fix').click();
  await expect(page.locator('#gp-count')).toHaveText('1 / 4 수업 내용');
  await expect(page.locator('#gen-lesson')).toHaveValue('리스트와 반복문');
});

test('미션 만들기 — 남은 0개면 안 보이는 탭의 버튼까지 꺼진다', async ({ page }) => {
  await missionTab(page, { left: 0, disabled: false });
  await expect(page.locator('#gen-btn')).toBeDisabled();
  await expect(page.locator('#sg-build')).toBeDisabled();
  await expect(page.locator('#gp-quick')).toBeHidden();
  await expect(page.locator('#dtab-missions .panel [style]')).toHaveCount(0);   // 인라인 style 없이 CSS 로
});

test('학생 상세 — 폰 폭: 서랍을 열고 Esc 는 서랍만, 한 번 더 누르면 상세가 닫힌다', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  await page.locator('#side-open').click();
  await page.locator('#side .room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await page.locator('.student-tile', { hasText: '태인' }).click();
  await expect(page.locator('#detail')).toBeVisible();
  await page.locator('#side-open').click();
  await expect(page.locator('#side')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#side')).toBeHidden();
  await expect(page.locator('#detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail')).toBeHidden();
});

test('미션 만들기 — 글씨는 읽을 크기, 누르는 곳은 44px 이상, 진행 막대는 채운 칸과 빈 칸이 다르다', async ({ page }) => {
  await missionTab(page);
  await page.locator('#gen-lesson').fill('리스트와 반복문');
  await page.locator('#sg-concept').click();
  await expect(page.locator('#gp-count')).toHaveText('2 / 4 개념 확인');
  const px = (sel, prop) => page.locator(sel).first().evaluate((e, p) => parseFloat(getComputedStyle(e)[p]), prop);
  for (const sel of ['.seg-b', '.gp-fix:visible', '#sg-concept-pick', '#sg-next', '#gt-quick'])
    expect((await page.locator(sel).first().boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
  await page.locator('.gp-s[data-step="1"] .gp-fix').click();
  for (const sel of ['#gen-diff', '#sg-concept'])
    expect((await page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
  expect(await px('.gp-s h3:visible', 'fontSize')).toBeGreaterThanOrEqual(20);
  for (const sel of ['.gp-body .lead', '.gp-quota', '.gp-lb', '.gp-ta', '#gen-diff', '.seg-b', '.gp-sum:visible'])
    expect(await px(sel, 'fontSize'), sel).toBeGreaterThanOrEqual(16);
  expect(await px('#gp-count', 'fontSize')).toBeGreaterThanOrEqual(15);
  const cells = page.locator('.gp-bar i');
  const bg = i => cells.nth(i).evaluate(e => getComputedStyle(e).backgroundColor);
  expect(await bg(0)).not.toBe(await bg(3));                          // 채운 칸과 빈 칸이 색으로 갈린다
  expect(await cells.nth(3).evaluate(e => parseFloat(getComputedStyle(e).borderTopWidth))).toBeGreaterThanOrEqual(2);
});

test('미션 만들기 — 만든 문제는 고치기로 돌아가도 남고, 개념이 바뀌면 먼저 묻고, 안 바뀌면 묻지 않는다', async ({ page }) => {
  test.setTimeout(120000);
  await sgBuild(page, [SG_FOR]);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 90000 });
  await expect(page.locator('#gp-count')).toHaveText('4 / 4 문제 확인');
  await page.locator('#sg-title').fill('내가 고친 이름');
  await page.locator('.gp-s[data-step="1"] .gp-fix').click();
  await expect(page.locator('.gp-s[data-step="4"] .gp-v')).toHaveText('내가 고친 이름');   // 요약은 고친 제목
  await page.locator('#sg-concept').click();
  await expect(page.locator('#gp-count')).toHaveText('2 / 4 개념 확인');          // 같은 개념 — 묻지 않는다
  await expect(page.locator('#gp-confirm')).toBeHidden();
  await expect(page.locator('#sg-title')).toHaveValue('내가 고친 이름');
  await page.locator('#sg-concept-pick').selectOption('while');
  await expect(page.locator('#gp-confirm')).toBeVisible();
  await expect(page.locator('#gp-confirm')).toContainText('만든 문제가 사라져요. 계속할까요?');
  await page.locator('#gp-no').click();
  await expect(page.locator('#sg-concept-pick')).toHaveValue('for');
  await expect(page.locator('#sg-title')).toHaveValue('내가 고친 이름');
  await page.locator('#sg-concept-pick').selectOption('while');
  await page.locator('#gp-yes').click();
  await expect(page.locator('#sg-title')).toHaveCount(0);
});

/* 최종 검토 보정 (2026-10-20) */
test('교실을 바꾼 뒤 늦게 온 옛 교실 응답은 새 교실에 알림을 쏟지 않는다', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  const late = [alEv('s1', '태인', { type: 's-redefine', mid: 'mx' }), alEv('s3', '한결', { type: 's-onboard', answers: [], skipped: false })];
  await page.evaluate(late => {   // r1 의 다음 폴링은 붙들어 둔다 — r2 는 바로 빈 기록
    window.CC.sb.getClassroomEvents = rid => rid === 'r1'
      ? new Promise(res => { window.__hung = true; window.__rel = () => res(late); })
      : Promise.resolve([]);
  }, late);
  await expect.poll(() => page.evaluate(() => !!window.__hung), { timeout: 8000 }).toBe(true);
  await page.locator('#side .room-tile', { hasText: '방과후' }).click();
  await expect(page.locator('#dash-title')).toHaveText('방과후');
  await page.waitForTimeout(800);                                   // r2 의 첫 응답이 기준선을 잡는다
  await page.evaluate(() => window.__rel());
  await page.waitForTimeout(800);
  await expect(page.locator('#alert-list li')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
});

async function alertLands(page, evs, sel) {
  const calls = await compassTeacher(page, [], b => b.action === 'list' ? { json: { rows: [cRow('M1')] } } : b.action === 'cumulative' ? { json: cumOf([cRow('M1')]) } : { status: 500, json: { error: 'x' } });
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await page.evaluate(e => { window.__evs.push(...e); }, evs);
  await expect(page.locator('#alert-list li.new')).toHaveCount(1, { timeout: 8000 });
  return calls;
}
const focused = (page, sel) => page.evaluate(s => document.activeElement === document.querySelector(s) && document.querySelector(s).getBoundingClientRect().top < innerHeight, sel);

test('알림을 누르면 그 알림이 말한 곳에 내려앉는다 — 마침은 나침반, 튜터는 대화 (이미 열려 있어도)', async ({ page }) => {
  test.setTimeout(60000);
  await alertLands(page, [judgeEv('M1', 'mx')]);
  await page.locator('.student-tile', { hasText: '태인' }).click();                     // 상세가 이미 열려 있다
  await page.locator('#detail .d-back').focus();
  await page.locator('#alert-list li .al-it').click();
  expect(await focused(page, '#detail .compass-card')).toBe(true);
});

test('알림을 누르면 튜터 대화에 내려앉는다', async ({ page }) => {
  test.setTimeout(60000);
  await alertLands(page, [...[1, 2, 3, 4, 5].map(i => alEv('s1', '태인', { type: 's-tutor', mid: 'mx', q: 'q' + i, a: 'a' }))]);
  await page.locator('#alert-list li .al-it').click();
  expect(await focused(page, '#detail .d-tutor')).toBe(true);
});

test('휴대폰 — 알림 화면에서 마침 알림을 누르면 나침반에 내려앉는다', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.addInitScript(() => { window.__evs = []; });
  await page.route('**/api/compass', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(r.request().postDataJSON().action === 'cumulative' ? cumOf([cRow('M1')]) : { rows: [cRow('M1')] }) }));
  await asTeacher(page);
  await page.locator('#side-open').click();
  await page.locator('#side .room-tile', { hasText: '태인한결' }).click();
  await page.evaluate(e => { window.__evs.push(e); }, judgeEv('M1', 'mx'));
  await expect(page.locator('#alerts-bar')).toContainText('칭찬 타이밍 1개', { timeout: 8000 });
  await page.locator('#alerts-bar').click();
  await page.locator('#alert-list li .al-it').click();
  await expect(page.locator('#alerts')).toBeHidden();
  expect(await focused(page, '#detail .compass-card')).toBe(true);
});

test('Esc — 중간 폭에서 겹친 알림을 닫는다', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await page.locator('#alerts-handle').click();
  await expect(page.locator('#alerts')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#alerts')).toBeHidden();
  await expect(page.locator('#alerts-handle')).toBeFocused();
});

test('폰 — 서랍의 사용법 보기를 누르면 서랍이 닫히고, 서랍이 열린 동안 본문은 스크롤되지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.addInitScript(() => { window.__evs = []; });
  await asTeacher(page);
  await page.locator('#side-open').click();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  await page.locator('#notes-toggle').click();
  await expect(page.locator('#side')).toBeHidden();
});

test('교실을 바꾸면 단계별 만들기는 처음부터 — 옛 교실의 초안이 새 교실에 저장되지 않는다', async ({ page }) => {
  test.setTimeout(120000);
  await sgBuild(page, [SG_FOR]);
  await expect(page.locator('.sg-answer')).toHaveText(['2300', '300', '0'], { timeout: 90000 });
  await page.locator('#side .room-tile', { hasText: '방과후' }).click();
  await expect(page.locator('#dash-title')).toHaveText('방과후');
  await page.locator('.main-tab[data-dtab="dtab-missions"]').click();
  await expect(page.locator('#sg-title')).toHaveCount(0);
  await expect(page.locator('#gp-count')).toHaveText('1 / 4 수업 내용');
  await expect(page.locator('.sg-ex')).toHaveCount(0);
  expect(await page.evaluate(() => window.__saved || [])).toEqual([]);
});


test('철학 틈 — 이유 두 글자 · 다시 고른 성공 조건은 처음 것이 남고 · 도움 요청은 증상 뒤에만', async ({ context, page }) => {
  await local(context);
  await seedMission(page);
  await page.locator('.m-btn[data-id="ai-e2e"]').click();
  await page.locator('#go-define').click();
  await page.locator('.define-card').nth(1).click();
  await page.locator('#reason-define').fill('.');
  await page.locator('#go-method').click();
  await expect(page.locator('#msg-define')).toHaveText('이유를 한 줄 적어 주세요.');
  await expect(page.locator('#step2')).toHaveClass(/active/);
  await page.locator('#reason-define').fill('모두 세야 하니까');
  await page.locator('#go-method').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  await expect(page.locator('#step3 .step-title')).toHaveText('내 설계');
  await page.locator('#back-define').click();
  await page.locator('.define-card').first().click();
  await page.locator('#go-method').click();
  const evs = await page.evaluate(() => window.CC.store.all().filter(e => e.type === 's-define' || e.type === 's-redefine'));
  expect(evs.length).toBe(2);
  expect(evs[1].type).toBe('s-redefine');
  expect(evs[1].from).toBe(evs[0].choice);
  expect(evs[1].to).not.toBe(evs[1].from);
  expect(evs[0]).toHaveProperty('trap');
  await expect(page.locator('#help-btn')).toBeHidden();
});

/* 사용법 안내를 끝까지 넘기며 'n / 총' 을 읽는다 — 총은 그대로, n 은 1씩 */
async function tourCounts(page) {
  const seen = [];
  while (await page.locator('.tour').count()) {
    seen.push((await page.locator('#tour-count').textContent()).split(' / ').map(Number));
    await page.locator('.tour-btn[data-a="next"]').click();
  }
  return seen;
}
function expectSteady(seen) {
  const msg = JSON.stringify(seen);
  expect(seen.length, msg).toBeGreaterThan(1);
  seen.forEach(([n, t], i) => { expect(t, msg).toBe(seen[0][1]); expect(n, msg).toBe(i + 1); });
  expect(seen.length, msg).toBe(seen[0][1]);
}

test('사용법 안내 — 선생님 교실 목록 화면: 총 단계 수가 끝까지 같고 번호는 1씩 오른다', async ({ context, page }) => {
  await context.addInitScript(() => { window.__tour = 1; });
  await asTeacher(page);
  await expect(page.locator('.tour')).toBeVisible();
  expectSteady(await tourCounts(page));
});

test('사용법 안내 — 선생님 교실 안: 총 단계 수가 끝까지 같고 번호는 1씩 오른다', async ({ context, page }) => {
  await context.addInitScript(() => { window.__tour = 1; });
  await asTeacher(page);
  await page.locator('.tour-btn[data-a="skip"]').click();
  await page.evaluate(() => localStorage.clear());
  await page.locator('#classroom-cards .room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.tour')).toBeVisible();
  expectSteady(await tourCounts(page));
  await page.locator('#tour-replay').click();
  expectSteady(await tourCounts(page));
});

test('선생님 화면을 닫은 동안 마친 미션은 다음에 열 때 알린다 — 확인할 때까지 남는다', async ({ context, page }) => {
  await local(context);
  await page.goto(BASE + '/teacher.html');          // 먼저 한 번 연다 — 이때 있던 일은 이미 본 것
  await expect(page.locator('#alert-list li')).toHaveCount(0);
  await page.goto(BASE + '/sentence.html');         // 화면을 떠난 동안 학생이 마친다
  await page.evaluate(() => {
    localStorage.setItem('cutcheck.log.v1', JSON.stringify([
      { v: 1, type: 's-code-judge', verdict: '지켰다', basis: '반례도 돌려 봤다', t: Date.now(), mid: 'sm1' }
    ]));
  });
  await page.goto(BASE + '/teacher.html');
  await expect(page.locator('#alert-list')).toContainText('마쳤어요');
  await expect(page.locator('#toasts .toast')).toHaveCount(0);   // 놓친 일은 목록에만 — 열자마자 토스트가 쏟아지지 않게
  await page.reload();
  await expect(page.locator('#alert-list li')).toHaveCount(1);  // 확인하기 전에는 새로고침해도 남는다
  await expect(page.locator('#toasts .toast')).toHaveCount(0);
  await page.locator('#alert-list li .al-ok').click();           // 확인하면 내려가고
  await expect(page.locator('#alert-list li')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#moments-empty')).toBeVisible();
  await expect(page.locator('#alert-list li')).toHaveCount(0);  // 다시 열어도 안 뜬다
});

test('선생님 알림 — 서버 모드: 새로고침 · 다른 기기에서도 확인할 때까지 남고, 학생을 열어 보는 것은 확인이 아니다', async ({ browser }) => {
  test.setTimeout(60000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__evs = window.__evs || JSON.parse(sessionStorage.__evs || '[]'); });
  await asTeacher(page);
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await expect(page.locator('#alert-list li')).toHaveCount(0);
  const add = [alEv('s1', '태인', { type: 's-redefine', mid: 'mx' }), alEv('s3', '한결', { type: 's-redefine', mid: 'my' })];
  await page.evaluate(add => { window.__evs.push(...add); sessionStorage.__evs = JSON.stringify(window.__evs); }, add);
  const items = page.locator('#alert-list li');
  await expect(items).toHaveCount(2, { timeout: 8000 });
  await items.filter({ hasText: '태인' }).locator('.al-it').click();   // 열어 보기만
  await expect(page.locator('#detail')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(items).toHaveCount(2);                                   // 새로고침해도 남는다 (열어 본 것도)
  await expect(page.locator('#toasts .toast')).toHaveCount(0);
  const ok = items.filter({ hasText: '태인' }).locator('.al-ok');
  await expect(ok).toHaveAccessibleName(/^확인 — 태인이 성공 조건을/);
  expect((await ok.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await ok.click();
  await expect(items).toHaveCount(1);
  await expect(items.locator('.al-ok')).toBeFocused();                  // 포커스는 남은 알림으로
  expect(await page.evaluate(() => JSON.parse(sessionStorage.__ckr1))).toEqual(['s1/redefine:mx']);
  await page.reload();
  await page.locator('.room-tile', { hasText: '태인한결' }).click();
  await expect(page.locator('.student-tile')).toHaveCount(3);
  await expect(items).toHaveCount(1);                                   // 확인한 것은 다시 열어도 안 뜬다
  await expect(items).toContainText('한결이 성공 조건을 스스로 바꿨어요.');
  await ctx.close();
});

test('강사 학생 상세 — 360 폭에서 긴 코드 · 긴 글 · 12칸 표가 있어도 옆으로 넘치지 않고, 글자는 크다', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route('**/supabase-js@*/**', r => r.abort());
  const LONG = '가'.repeat(300), CODE = 'x=' + 'a+'.repeat(59);
  await page.route('**/js/data/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: `(function(CC){var P=function(v){return Promise.resolve(v)};
var LONG=${JSON.stringify(LONG)},CODE=${JSON.stringify(CODE)},now=Date.now();
function ev(e){e.v=1;e.t=now;return {student_id:'s1',mission_id:'M1',created_at:new Date().toISOString(),profiles:{name:'태인'},event:e}}
CC.sb={active:function(){return true},getUser:function(){return P({id:'t1'})},getProfile:function(){return P({role:'teacher',name:'김선생'})},onAuthChange:function(){},signOut:function(){return P()},
myClassrooms:function(){return P([{id:'r1',name:'반',code:'AB12CD'}])},getMissions:function(){return P([])},getClassroomStudents:function(){return P([{id:'s1',name:'태인'}])},
getClassroomEvents:function(){return P([ev({type:'s-code',mid:'mx',code:CODE,dataId:'[1]',output:LONG,error:''}),ev({type:'s-code-judge',mid:'mx',verdict:'지켰다',basis:LONG}),ev({type:'s-redefine',mid:'mx',why:LONG})])},
compass:function(a){var CK=['N1','N2','N3','E1','E2','E3','S1','S2','S3','W1','W2','W3'],ck={};CK.forEach(function(k){ck[k]={ok:k==='N2',quote:k==='N2'?LONG:''}});var row={studentId:'s1',missionId:'M1',checks:ck,tutor_dirs:{N:1,E:0,S:0,W:0},teacher_dir:'N',teacher_note:LONG,sent_at:'2026-10-20T00:00:00Z'};if(a==='list')return P({rows:[row]});if(a==='cumulative')return P({cumulative:{needle_deg:10,dir:'N',length:0.7,cancel:false,candidates:[],n:1},rows:[row]});return Promise.reject(new Error('x'))}}
})(window.CC=window.CC||{});` }));
  await page.goto(BASE + '/teacher.html');
  await page.locator('.student-tile', { hasText: '태인' }).click();
  const d = page.locator('#detail');
  await expect(d.locator('.compass-card')).toBeVisible();
  await d.locator('details.compass-more > summary').click();
  for (const f of await d.locator('details.k-fold:not([open]) > summary').all()) await f.click();
  const o = await page.evaluate(() => {
    const px = s => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) : 99; };
    const wrap = document.querySelector('.compass-tablewrap');
    return { page: document.documentElement.scrollWidth - innerWidth, det: document.querySelector('#detail').scrollWidth - document.querySelector('#detail').clientWidth,
      body: Math.min(px('#detail'), px('.d-rows dd'), px('.compass-card'), px('.k-note'), px('.compass-gist .gv'), px('.d-tutor .lead')),
      small: Math.min(px('.d-rows dt'), px('.d-rows .tm'), px('.compass-gist .gk'), px('.d-qs .who'), px('.d-tbl th'), px('.compass-msg'), px('.d-step-h')),
      name: px('#detail .big-title'), tw: wrap ? wrap.scrollWidth > wrap.clientWidth : null };
  });
  expect(o.page).toBeLessThanOrEqual(0);
  expect(o.det).toBeLessThanOrEqual(0);
  expect(o.body).toBeGreaterThanOrEqual(17);
  expect(o.small).toBeGreaterThanOrEqual(16);
  expect(o.name).toBeGreaterThanOrEqual(30);
});
