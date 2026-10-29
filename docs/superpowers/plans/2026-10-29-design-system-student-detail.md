# 선생님 학생 상세 화면 + 공통 컴포넌트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선생님 학생 상세 화면을 A안(요약 → 할 일 → 접힌 기록)으로 다시 그리고, 그 화면의 반복 조각을 `CC.kit` 컴포넌트로 뽑고, 전·후를 숫자로 비교한다.

**Architecture:** `js/ui/kit.js`(전역 `CC.kit`)와 `kit.css` 한 쌍에 `el` · `esc` · 접는 줄 · 칩 · 요약 카드 · 안내 상자 · 코드 블록을 둔다. `teacher.js` 의 `openDetail` 이 그걸 조립한다. 판단 로직(`core/`)과 나침반 계산 · 서버 호출은 건드리지 않는다.

**Tech Stack:** 순수 JS(IIFE, `CC` 전역) · 순수 CSS · 테스트는 기존 Node 스크립트와 Playwright(`test/e2e-flow.spec.js`). 번들러 · 의존성 · ES 모듈 없음.

**Spec:** `docs/superpowers/specs/2026-10-29-design-system-student-detail-design.md`

## Global Constraints

- 번들러 · npm 의존성 · ES 모듈(import/export)을 쓰지 않는다. 정적 파일만.
- `js/ui/` 는 `core` · `data` 를 알아도 되고, 서버가 있는지 없는지는 `CC.sb.active()` 로만 묻는다. `core` 에서 `document` 를 쓰지 않는다 (`test/layer.test.js`).
- 점수 · 순위 · 정답률 · 반 평균 · 소요 시간 · 다음 블록 추천을 화면에 넣지 않는다. 칭찬 낱말 · 판정 문구를 쓰지 않는다 (사실만).
- 학생 화면(`index` `sentence` `abstract` `review` `make`)과 `core/fold.js` · `core/compass.js` · `api/` 는 고치지 않는다.
- 새 색 · 새 글꼴 체계를 만들지 않는다. `styles.css` 의 변수(`--ink` `--surface` `--line` `--folder` `--coral` …)만 쓴다.
- 글자 키우기는 `#detail` 안에서만 (본문 18px 안팎, 이름 30px 이상). 명단 · 알림은 그대로.
- 접는 줄은 `<details>`. 새 클래스 접두사는 `k-` 이되, 이미 있는 `.k-data` `.k-action` `.k-output` `.k-control`(블록 종류, `styles.css`)과 겹치지 않는 이름만 쓴다.
- 학생이 쓴 글(성공 조건 · 정리 문장 · 한마디 · 만든 미션)은 `textContent` 로만 넣는다 (`test/robust.js` 가 지킨다).
- 커밋 메시지는 왜 그렇게 정했는지와 거절한 선택지를 적는다 (CLAUDE.md). 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- 모든 Task 끝에 `node test/smoke.js` 와 해당 Task 의 Playwright 테스트가 통과해야 커밋한다. 마지막 Task 에서 CLAUDE.md 의 Node 테스트 전부.

## 코드를 읽고 정한 것 (설계 문서와 어긋나는 곳 — 사용자에게 알릴 것)

설계 문서를 쓴 뒤 `teacher.js` 를 읽고 알게 된 사실. 아래 호출은 계획 작성자의 판단이다.

1. **"선생님 한마디"와 "방향 고르기"는 이미 `compassCard` 안에 있다** (`compass-form` textarea · `compass-cand` 버튼). 새로 만들지 않고 자리만 옮긴다.
2. **`.compass-card` 는 테스트 80여 군데가 한 덩어리로 가정한다** (`card.locator('.compass-form')` · 포커스 · `boundingBox` 너비). 그래서 `.compass-card` 를 **테두리 없는 바깥 틀**로 남기고, 그 안을 ① 요약 카드 ② 할 일 ③ 접힌 나침반 자세히 로 나눈다. 결과: "나침반 자세히"(접힘 한 줄)가 미션 기록 **위**, 할 일 바로 아래에 온다. 시안(미션 기록 아래)과 다르다. 아래로 옮기려면 테스트 80여 줄을 다시 써야 해서 이렇게 정했다.
3. **"미션별 접는 줄"은 데이터 흐름 변경이 필요하다.** 지금은 미션 알약(`.mf`)으로 한 미션을 골라 단계(01~05)별로 묶어 보여 준다. 이를 "미션마다 접는 줄 하나"로 바꾸고 `.mf` 알약은 없앤다. 줄 만드는 코드를 `missionRecords(s, mid)` 로 꺼낸다. `openDetail(s, mid)` 의 `mid` 는 남긴다 — 알림에서 열면 그 미션 줄이 열린 채로 오고, 한마디 칸도 그 미션만 보인다.
4. **"잘한 점" 칸의 재료는 이미 있는 `.d-flags` 표시(사실)** 다: 다시 정함 · 에러 뒤 스스로 고침 · 스스로 깨뜨림 · (살펴볼 것은 `.mark.look`). 칭찬 낱말을 새로 쓰지 않으려고 제목은 지금 쓰는 **"눈에 띄는 것"** 으로 한다. 시안의 "잘한 점" 제목은 쓰지 않는다.
5. **튜터 대화 칸(`.d-tutor`)은 설계 문서에 없었다.** 내용은 그대로 두고 글자 크기와 칩 · 코드 블록 컴포넌트만 적용한다 (복구 버튼 `recap-go` 가 늘 보여야 하는 테스트가 있다).

## Review Focus

각 줄의 테스트는 해당 Task 안에 있다.

1. 기록이 하나도 없는 학생(`noRecord`) — 요약 카드와 "아직 기록이 없어요"가 뜨고 에러가 없다. (Task 3)
2. 서버 없는 로컬 모드 — 나침반 없이 요약 카드(눈에 띄는 것)와 미션 줄이 나온다. (Task 3)
3. 방향이 상쇄된 학생에서 후보를 고르고 한마디를 보낸 뒤 다시 그려도, 열어 둔 접는 줄과 쓰던 초안이 남는다. (Task 3)
4. 360px 폭에서 가로 스크롤이 없다 — 긴 코드 · 긴 학생 글 · 12칸 표. (Task 4)
5. 알림으로 특정 미션을 열면 그 줄이 열려 있고 초점이 간다. (Task 2)

---

### Task 0: 이전 숫자 재기

**Files:**
- Create: `test/kit-metrics.js`
- Create: `docs/superpowers/specs/2026-10-29-design-system-before-after.md`

**Interfaces:**
- Produces: `node test/kit-metrics.js` 가 아래 5개 숫자를 `이름 : 값` 줄로 출력한다. 이후 Task 가 같은 스크립트를 다시 돌려 "이후" 열을 채운다.

측정 항목 (정의를 고정해야 전·후가 비교된다):
1. `detail-js-lines` — `teacher.js` 의 `openDetail` · `compassCard` · `compassGist` · `levelRecords` · `codeBlock` · `row` · `mark` · `was` 함수 몸통 줄 수 합 (함수 시작 줄 ~ 같은 들여쓰기의 다음 `  function`/`  var` 직전).
2. `detail-css-rules` — `teacher.css` 에서 `.detail`, `.d-`, `.compass-`, `.lv-`, `.mf`, `.saybox` 로 시작하는 선택자 줄 수.
3. `helper-defs` — `js/ui/*.js` 안의 `var el = function` + `function esc` 정의 개수.
4. `dup-class-defs` — `.chip` `.tag` `.mark` `.code` `.btn` 각각을 줄 머리에서 정의하는 CSS 파일 수의 합.
5. `files-to-restyle-chip` — `.chip` 모양을 바꿀 때 고쳐야 하는 파일 수 (= `.chip` 을 줄 머리에서 정의하는 CSS 파일 수).

- [ ] **Step 1:** `test/kit-metrics.js` 를 쓴다 (Node, 의존성 없음, `fs` 와 정규식만). 인자 없이 실행하면 위 5줄을 출력하고, 어떤 파일에서 셌는지는 출력하지 않는다.
- [ ] **Step 2:** 실행해서 5개 숫자가 나오는지 확인한다. 기대: 모두 0 이 아님, `helper-defs` 는 설계 때 센 `el` 6 + `esc` 4 (= 10 근처. 정확한 값은 출력을 따른다).
- [ ] **Step 3:** 출력을 `...-before-after.md` 의 표 "이전" 열에 적는다. 열은 `이전 | 이후 | 줄어든 정도`, "이후"는 비워 둔다. 표 아래에 한 줄: 측정은 `node test/kit-metrics.js`, 이전 코드는 이 문서가 들어간 커밋의 부모에서 확인.
- [ ] **Step 4:** Commit — `test/kit-metrics.js`, 위 문서. 메시지: 전·후를 말이 아니라 숫자로 남기려는 이유.

### Task 1: `CC.kit` 바탕 — `el` · `esc` · 칩 · 접는 줄 · 안내 상자 · 코드 블록

**Files:**
- Create: `js/ui/kit.js`, `kit.css`
- Modify: `teacher.html` (`<link>` 와 `<script src="js/ui/kit.js">` 를 `teacher.js` 앞에), `js/ui/teacher.js:11-17,93-97` (로컬 `el` · `esc` 제거 → `CC.kit` 에서 받기), `js/ui/teacher.js:212-218` (`codeBlock` · `mark` · `was` 를 kit 호출로)
- Modify: `teacher.css` (`.chip` · `.mark` · `.detail .code` 중 kit 와 겹치는 규칙 제거)
- Test: `test/e2e-flow.spec.js` 기존 학생 상세 테스트 전체 (동작은 그대로여야 한다)

**Interfaces:**
- Produces (모두 `CC.kit.*`, `kit.js` 는 `(function (CC) { ... })(window.CC = window.CC || {})` 꼴 — 다른 ui 파일과 같은 방식):
  - `el(tag: string, cls?: string, txt?: string) -> HTMLElement` — 기존 `el` 과 같은 동작 (`txt != null` 이면 `textContent`).
  - `esc(s: any) -> string` — 기존 `esc` 와 같은 동작 (`& < > "`).
  - `chip(txt: string, opts?: { look?: boolean }) -> HTMLElement` — 클래스 `k-chip` (+ `look` 이면 `k-chip look`). 기존 `.mark` 와 `.mark.look` 의 모양(노란 바탕 / 붉은 테두리)을 그대로 옮긴다.
  - `fold(title: string, opts?: { open?: boolean, onToggle?: (open: boolean) => void }) -> { root: HTMLDetailsElement, body: HTMLElement }` — `<details class="k-fold"><summary>…</summary><div class="k-fold-body"></div></details>`.
  - `note(label: string, text: string) -> HTMLElement` — 기존 `.saybox` 와 같은 구조(`span.k` + `span`), 클래스 `k-note`.
  - `code(src: string) -> HTMLPreElement` — 기존 `codeBlock` 과 같은 결과(줄마다 `span.ln`, 줄 번호는 CSS 카운터).
- Consumes: 없음.

- [ ] **Step 1:** `test/e2e-flow.spec.js` 에서 `.mark` · `.code` · `.saybox` 를 직접 고르는 테스트가 있는지 확인한다 (설계 시 grep: `.saybox` 만 `e2e-flow.spec.js:798,2745`). 이 Task 에서 `.saybox` 클래스는 `k-note` 와 **함께** 붙여 둔다(`k-note saybox`) — 이름 교체는 Task 3 에서 테스트와 같이.
- [ ] **Step 2:** 현재 상태에서 `node test/smoke.js` 와 학생 상세 관련 e2e 를 돌려 통과(기준선)임을 확인한다. 통과하지 않는 것이 있으면 이 Task 로 인한 것이 아님을 메모해 둔다.
- [ ] **Step 3:** `kit.js` · `kit.css` 를 위 시그니처대로 쓴다. `.k-chip` 은 `teacher.css` 의 `.detail .mark` 값을 옮긴 것이므로 화면이 바뀌지 않아야 한다. `teacher.js` 의 `mark(dd, txt, look)` 는 `dd.appendChild(kit.chip(txt, {look}))` 로 바꾸되, `row()` 가 `dd.querySelector('.mark')` 로 순간 줄을 가르므로 `k-chip` 에도 `mark` 클래스를 함께 붙여 둔다 (Task 3 에서 이름 정리).
- [ ] **Step 4:** 같은 두 테스트를 다시 돌려 기준선과 같은지 확인한다. 기대: 통과 수 동일, `smoke.js` 의 가로 스크롤 · 금지 단어 0건.
- [ ] **Step 5:** `node test/layer.test.js` 통과 확인. Commit — 로컬 `el`/`esc` 를 지운 것 중 teacher.js 만이고 나머지 5개 파일은 후보 목록에만 올리는 이유를 메시지에.

### Task 2: 미션별 접는 줄 — 기록 만드는 코드를 `missionRecords` 로

**Files:**
- Modify: `js/ui/teacher.js:589-895` (`openDetail` 의 기록 만들기 `657-847` 를 `missionRecords` 로 꺼내고, `.mf` 알약 `637-650` 제거)
- Modify: `teacher.css` (`.mf*` · `.d-rows` · `.d-step*` 중 안 쓰는 규칙 제거, 접는 줄 안의 단계 제목 스타일)
- Modify: `test/e2e-flow.spec.js:1704-1712,2773,801` 과 `test/shots.js` 중 `.mf` · `.d-step-h` 를 쓰는 곳

**Interfaces:**
- Consumes: Task 1 의 `CC.kit.fold`.
- Produces: `function missionRecords(s, mid, all) -> HTMLElement` — 한 미션(`mid`)의 `evs` 로 지금의 `dl` → 단계별 `.d-step` 묶음(`box`)을 만들어 돌려준다. `mid === null` 이면 예전 블록 미션 기록(`785-821` 의 `if (!mid)` 줄들)을 담은 "다른 미션 기록" 묶음을 돌려준다. 반환 요소 안에 `.d-step-h` 가 단계 제목으로 남는다. 반환값에 줄이 없으면 `p.emptyrow` '아직 기록이 없어요.'.
- 줄(`row`)의 정의와 `fold`/`mark` 동작은 그대로. `openDetail(s, mid, focusSection)` 시그니처는 그대로.

- [ ] **Step 1: 실패하는 테스트.** `test/e2e-flow.spec.js` 의 기존 "미션 알약" 테스트(`.mf` 를 누르는 `1704` 근처, `2773` 근처)를 새 동작으로 바꿔 쓴다: 미션이 둘인 학생을 열면 `#detail details.k-fold` 가 미션 수만큼(+ 예전 기록이 있으면 1) 있고, 가장 최근 미션 줄이 DOM 위에 있고, `#detail .mf` 는 0개다. 알림으로 특정 미션(`openDetail(s, mid)`)을 열면 그 미션 줄만 `open` 이고 `compass-form` 도 그 미션 것만 보인다. (Review Focus 5)
- [ ] **Step 2:** `npx playwright test -g "<방금 바꾼 테스트 이름>"` — 기대: FAIL (`.mf` 가 아직 있음).
- [ ] **Step 3:** `missionRecords` 를 꺼내고 `openDetail` 이 `ms`(최근이 위로 뒤집은 순서) 마다 `kit.fold(missionName(id, i))` 를 만들어 그 안에 `missionRecords(s, id, all)` 을 넣게 한다. 학생 줄(`flags` 모으기)은 모든 미션 줄에서 모은다 — 이 값은 Task 3 의 요약 카드가 쓰므로 `openDetail` 지역 변수로 `marks: Array<{txt, look}>` 를 만들어 둔다 (중복 제거는 지금 `seenFlag` 규칙 그대로). 한 미션뿐이면 그 줄은 `open`. `.mf` 알약 코드와 CSS 를 지운다.
- [ ] **Step 4:** 위 테스트와 `.d-step-h` 를 쓰는 테스트(`801`)가 통과하는지 확인. 전체 학생 상세 e2e 재실행 — 기대: 기준선과 같은 통과 수 (바꾼 테스트 제외).
- [ ] **Step 5:** `node test/robust.js` — 학생 자유 입력이 접힌 줄 안에서도 `textContent` 로 올라오는지. Commit — 미션 알약을 없앤 이유(접는 줄이 같은 일을 하고 눌러서 고르는 단계가 하나 줄어든다)와 거절한 대안(알약 유지 + 접는 줄 추가: 같은 정보가 두 번 나옴).

### Task 3: 요약 카드 · 할 일 · 접힌 나침반 자세히 — 자리 바꾸기

**Files:**
- Modify: `js/ui/teacher.js:407-556` (`compassCard` 의 `draw()` 가 세 칸으로 나눠 그린다), `589-895` (`openDetail` 의 위쪽 순서), `560-586` (`levelRecords` → `kit.fold`)
- Modify: `js/ui/kit.js` (요약 카드 추가), `kit.css`, `teacher.css`
- Modify: `test/e2e-flow.spec.js:2745,798,2207-2340` 근처 (순서 · `.saybox` 이름 · 접힘 상태), `test/shots.js:289-291`

**Interfaces:**
- Consumes: Task 1 `CC.kit.{chip,fold,note}`, Task 2 의 `marks: Array<{txt: string, look: boolean}>`.
- Produces: `CC.kit.summary(opts: { title: string, chips: Array<{txt: string, look?: boolean}>, aside?: Node|null }) -> HTMLElement` — 클래스 `k-summary` (노란 `--folder` 바탕, 테두리, 큰 글씨). `chips` 가 비면 한 줄 '표시할 것이 아직 없어요.'. `aside` 는 오른쪽 자리(나침반 그림 · 방향).
- DOM 순서(위→아래), `#detail` 직계: `.d-back` → `.d-head` → `.compass-card`(서버 모드일 때만) [안: `.k-summary` → `.compass-todo`(후보 고르기 + 한마디 칸) → `details.compass-more`(접힘)] → 서버가 아니면 `.k-summary` 가 대신 `.d-head` 아래에 → `.k-note.saybox` → `section.d-main`(미션 줄들) → `.d-level`(접는 줄) → `.d-tutor`.

  핵심 제약: `.compass-card` 는 이전처럼 포커스 · 스크롤 대상이고 `draw()` 가 `card.innerHTML` 을 다시 쓰는 구조를 유지한다. `cMore` · `cPick` · `cDraft` 같은 상태 맵은 그대로.
- `.saybox` 는 `k-note` 로 이름을 바꾸고 `e2e-flow.spec.js:798,2745` 의 선택자도 `.k-note` 로 같이 바꾼다. 순서 테스트(`2745`)는 `['.d-head', '.k-summary', '.k-note', '.d-main', '.d-tutor']` 의 `offsetTop` 이 오름차순인지로 바꾼다.

- [ ] **Step 1: 실패하는 테스트.** (a) 서버 모드, 방향이 정해진 학생: `.k-summary` 가 `.d-head` 아래 · `.d-main` 위에 있고 그 안에 `.compass-dir` 와 `.k-chip` 이 있다. (b) 상쇄 학생: `.compass-todo` 안에 `.compass-cand` 가 있고 `.k-summary` 안에는 `svg .compass-needle` 이 없다; 후보를 고르고 보낸 뒤 다시 그려도 `aria-pressed="true"` 와 쓰던 textarea 값이 남고 `details.compass-more` 의 `open` 상태도 유지된다. (Review Focus 3) (c) `noRecord` 학생: `.k-summary` 가 있고 '표시할 것이 아직 없어요.' 가 보이며 JS 에러가 없다. (Review Focus 1) (d) 서버 없는 로컬 모드: `.compass-card` 는 0개, `.k-summary` 는 1개. (Review Focus 2)
- [ ] **Step 2:** 새 테스트만 실행 — 기대: FAIL (`.k-summary` 없음).
- [ ] **Step 3:** `kit.summary` 를 쓰고, `compassCard` 의 `draw()` 를 (요약: 그림 · 방향 · 한 줄 · `compassGist` / 할 일: 상쇄 후보 · 미션별 한마디 `compass-form` / 접힘: 12칸 표 · 튜터 분포) 세 컨테이너로 나눠 쓴다. `openDetail` 은 `marks` 를 `compassCard(s, mid, nameOf, marks)` 에 넘겨 요약 카드 칩으로 쓰고, 서버가 아니면 `kit.summary` 를 직접 붙인다. `levelRecords` 는 `kit.fold('레벨 테스트 기록')` 으로 감싼다 (`.lv-rec` 안쪽 구조는 그대로). `.d-flags` 는 지운다 (요약 카드가 대신).
- [ ] **Step 4:** 새 테스트 + 바꾼 순서 테스트 + 나침반 e2e 전체(`2207-2420` 근처) 실행. 기대: 모두 통과, `.compass-table` 은 접힘 상태에서 안 보이고 summary 클릭 시 보이는 기존 단언도 그대로 통과.
- [ ] **Step 5:** `node test/smoke.js` · `node test/compass.test.js` · `node test/robust.js` 통과 확인. Commit — "잘한 점" 대신 "눈에 띄는 것" 을 쓴 이유(칭찬 낱말은 사람이 한다), `.compass-card` 를 쪼개지 않고 바깥 틀로 남긴 이유(테스트 80여 군데가 한 덩어리 가정), 거절한 선택지(나침반 자세히를 미션 기록 아래로).

### Task 4: 글자 크기 · 폭 점검

**Files:**
- Modify: `teacher.css` (`.detail` 규칙), `kit.css`
- Test: `test/smoke.js` (이미 3폭 × 2테마), `test/e2e-flow.spec.js` 에 폭 360 단언 하나

**Interfaces:** 없음.

- [ ] **Step 1: 실패하는 테스트.** 폭 360px 에서 긴 코드(120자 한 줄) · 긴 학생 글(300자, 공백 없음) · 12칸 표가 있는 학생을 열었을 때 `document.documentElement.scrollWidth <= innerWidth`, `#detail` 본문 글자 크기가 `>= 17px` 이다. (Review Focus 4)
- [ ] **Step 2:** 실행 — 기대: 글자 크기 단언에서 FAIL.
- [ ] **Step 3:** `#detail` 안에서만 `font-size` 를 올린다 (본문 18px, 부가 글자 16px 아래로 안 내림, 이름 30px 이상). 긴 줄은 `overflow-wrap: anywhere`, 표는 `.compass-tablewrap` 안에서만 가로로 밀리게. 명단 · 알림의 글자는 안 건드린다.
- [ ] **Step 4:** `node test/smoke.js` — 10개 화면 × 3폭 × 2테마 통과. e2e 폭 단언 통과. 사람이 쓰는 브라우저에서 라이트 · 다크 한 번씩 눈으로 본다.
- [ ] **Step 5:** Commit.

### Task 5: 이후 숫자 · 후보 목록 · 전체 검증

**Files:**
- Modify: `docs/superpowers/specs/2026-10-29-design-system-before-after.md`
- Create: 같은 문서의 "다른 화면 후보" 절 (새 파일 아님)

- [ ] **Step 1:** `node test/kit-metrics.js` 를 다시 돌려 "이후" 열과 "줄어든 정도"를 채운다. 숫자가 **늘어난 항목**(예: 새 CSS 규칙, kit 파일 줄 수)도 숨기지 않고 표에 같이 적는다 — kit 파일 자체의 줄 수를 `새로 생긴 코드` 행으로 넣는다. 줄어들지 않은 항목이 있으면 이유를 한 줄로 쓴다.
- [ ] **Step 2:** "다른 화면 후보" 절을 쓴다. 대상: 학생 5개 화면 + `admin.html` + 선생님 명단 · 알림 쪽. 각 후보는 `화면/파일:줄 — 지금 모습 — 대응하는 kit 컴포넌트(또는 새로 필요한 것)` 한 줄. `grep` 으로 `var el = function`(5곳) · `function esc`(3곳) · 카드류(`.rescard` `.wrapcard` `.sentcard` `.peercard`) · 버튼류(`.btn` `.pill` `.tbtn` `.mbtn` `.iconbtn`) · 라벨류(`.tag` `.badge` `.mark` `.al-tag`)의 실제 사용 위치를 찾아 쓴다. 바꾸지는 않는다.
- [ ] **Step 3:** CLAUDE.md 의 Node 테스트(`engine` `hangul` `llmguard` `layer` `alerts` `smoke` `robust` `compass` `slide2`)와 `npx playwright test` 를 모두 돌려 통과를 확인한다. 실패가 이 작업 때문이 아니면 (이전 기준선과 같으면) 그렇게 기록한다.
- [ ] **Step 4:** CLAUDE.md "파일 구조" 절의 `js/ui/` 목록에 `kit.js` 한 줄을 더한다 (이게 이 저장소가 새 파일을 알리는 방식). `.gitignore` 에 `.superpowers/` 를 더한다.
- [ ] **Step 5:** Commit — 전·후 숫자 요약과, 학생 화면은 이번에 안 건드렸다는 점을 메시지에.
