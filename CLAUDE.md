# KOMPAS — 작업 규칙

(예전 이름 Cut & Check. 이름·아이콘의 뜻은 [docs/superpowers/specs/brand.md](docs/superpowers/specs/brand.md))

이 저장소에 기능을 추가하는 사람(그리고 AI)이 먼저 읽는 문서다.
설계 철학 전문은 [docs/philosophy.md](docs/philosophy.md) 에 있다. 여기는 **작업 규칙**이다.

---

## 한 줄

> 시작은 대신해주고, 판단은 하나도 대신하지 않는다.

기능을 붙이기 전에 스스로 묻는다. **이건 시작 비용을 줄이는 건가, 판단을 대신하는 건가?**
판단을 대신하는 쪽이면 그 기능은 만들지 않는다. 아무리 친절해 보여도.

---

## 만들면 안 되는 것

아래는 전부 한 번씩 "좋은 아이디어"로 제안됐다가 거절된 것들이다.
다시 제안될 것이므로 이유를 붙여 적어둔다.

| 만들면 안 되는 것 | 왜 |
|---|---|
| 점수 · 포인트 · 연속 출석 · 레벨 | 칭찬을 기계에 넘기면 사람의 격려가 싸구려가 된다 |
| "좋아요!" 같은 성공 팝업 | 같은 이유. 인정은 사람의 일이다 |
| 정답 블록 순서와 대조하는 채점 | 채점하는 순간 학생은 우리 답을 추측하기 시작한다 |
| 다음에 놓을 블록 추천 | 판단 대행의 가장 흔한 형태 |
| 실행 전에 열리는 힌트 · 코드 보기 | 증상을 말하기 전에 주면 말할 이유가 사라진다 |
| 방법을 지시하는 체크리스트 | "쉼표를 기준으로 나누기"는 요구사항이 아니라 정답 공개다 |
| 앞뒤 공백을 알아서 봐주는 비교 | 봐주면 학생은 그 개념을 평생 만나지 못한다 |
| 교사 화면의 정답률 · 순위 · 소요 시간 랭킹 | 숫자를 띄우면 교사가 줄을 세우고, 학생은 다시 결과를 맞히러 간다 |
| 학생 화면에 반 전체 현황 표시 | 옆자리가 어디까지 갔는지 보이면 수업이 속도 경쟁이 된다 |
| AI가 쓰는 칭찬 문구 | 타이밍만 알려주고 말은 교사가 한다 |

**예외 하나 — 학생별 레벨(상/중/하)은 선생님 화면에만 보인다.** 2026-10-19 사람이 정했다:
레벨 테스트 진단 결과를 선생님이 명단에서 보고 반 분포로 문제 난이도를 맞춘다.
학생 화면에는 절대 나가지 않는다 — 위 표의 "레벨" 금지는 학생 쪽에 그대로 살아 있다.
되돌리거나("레벨은 금지인데요") 학생 쪽으로 넓히자고 다시 제안하지 않는다.

**예외 둘 — 나침반.** 2026-10-20 사람이 정했다(2차): 방향마다 예/아니오 3항목(코드 8 · AI 4, AI 는 기록에 글자 그대로 있는 인용이 있어야 예),
충족 개수가 그 방향 점수. 학생 방향은 최근 5개 미션의 가중 평균 벡터(`WEIGHTS` · `CANCEL` 은 `api/_compass.py` 한 곳, 해 보면서 고친다).
체크 항목 · 점수 · 인용 · 튜터 질문 분포는 선생님 화면에만. 학생에게는 누적 바늘 · 방위 · 선생님 한마디만 간다. 점수와 평균은 저장하지 않는다(원본 판정만).
벡터가 상쇄되면 기계가 정하지 않는다 — 선생님에게 칭찬 타이밍 알림이 가고 겹친 후보 중 하나를 선생님이 고른다. 고르기 전에는 학생 바늘을 바꾸지 않는다.
학생 문장은 AI 가 쓰지 않는다. 단계로 정렬 · 순위를 만들지 않는다. 설계: `docs/superpowers/specs/2026-10-20-compass-v2-design.md`.

**레벨 테스트 기록.** 문제지는 하 · 중 · 상(`js/core/onboard.js`, 정답표 `KEY` 는 그 파일 밖으로 나가지 않는다). 강사가 지정할 때 문제지를 고른다.
이벤트에는 문제지(`set`)와 학생이 고른 답만 남고, 맞힌 수 · 레벨은 선생님 화면이 그때 계산한다. 학생 화면에 문제지 이름 · 맞음 · 점수를 띄우지 않는다.
마지막 테스트 뒤 `RETEST_DAYS`(60) 가 지나면 "레벨 테스트" 알림.

**알림은 타이밍만.** 선생님 화면 오른쪽 알림(`js/core/alerts.js`)은 세 이름표 — 칭찬 타이밍(미션 마침 · 성공 조건 바꿈 · 스스로 고침 · 나침반 상쇄) · 살펴볼 것 · 레벨 테스트(마침 · 재테스트).
학생·미션당 종류별 한 번. 알림은 선생님이 **확인** 버튼을 누를 때까지 남는다 — 새로고침 · 다른 브라우저 · 다른 기기에서도
(2026-10-22 사람 피드백). 알림을 눌러 학생을 열어 보는 것은 확인이 아니다. 계산은 그대로 `CC.alerts`(순수)가 하고,
확인한 키(`CC.alerts.keyOf` = `학생/종류:미션`)만 `CC.alertChecks`(`js/data/checks.js`)가 서버면 DB `alert_checks`, 없으면 localStorage 에 둔다.
기능을 켠 시각(서버: 마이그레이션 적용 시각 `alert_checks_since()`, 로컬: 이 브라우저가 처음 연 시각) 이전 일은 확인한 것으로 친다 —
첫 배포 날 몇 주 치가 쏟아지지 않게. 화면을 열 때 이미 있던 확인 안 한 일은 토스트 없이 목록에만 올린다. "확인함" 보기는 만들지 않았다(기록은 학생 상세에 그대로 있다). 문장은 사실만 쓰고 칭찬 낱말을 넣지 않는다
(말은 선생님이 한다). 순서 번호 · 소요 시간 · 반 평균을 붙이지 않는다. "튜터에게 많이 물었어요" 기준은 `TUTOR_MANY`(5) 하나.

---

## 화면 문구 규칙

학생이 보는 문장은 아래를 지킨다. `node test/llmguard.test.js` 가 일부를 자동 검사한다.

- **에러는 위치와 사실만.** "3번 블록이 값을 못 받았어요." (O) / "자르기 블록을 넣으세요." (X)
- **원인을 대신 짚지 않는다.** "블록이 없어서 안 나뉜 거야" 는 학생이 찾아야 할 결론이다.
- **질문은 물음표로 끝난다.** 80자를 넘기지 않는다 — 중1은 안 읽는다.
- **조사를 계산한다.** `CC.josa()` / `CC.particle()`. "개수이 나올 줄"이 뜨는 순간
  학생은 이 도구를 대충 만든 물건으로 분류한다.
- **판정하지 않는다.** "틀렸어요" 대신 결과를 보여주고 학생이 판정하게 한다.
- **말투를 섞지 않는다.** 화면이 학생에게 말할 때는 존댓말(`~해요`).
  제목과 라벨은 학생 1인칭 명사형(`내 미션 만들기`, `이제 내가 깨뜨릴 차례`).
  **반말은 AI 되묻기(`js/asks.js`)에만** 쓴다 — 같은 편에 서 있다는 신호라서 거기만 예외다.
  화면이 학생을 `너`라고 부르지 않는다.
- **고치는 문을 막지 않는다.** 자를 기준도, 성공 조건도 다시 정할 수 있어야 한다.
  고친 이력은 숨기지 않고 화면에 남긴다.

---

## 새 미션을 추가할 때

`js/missions.js` 에 객체 하나를 더한다. 아래 넷은 협상 대상이 아니다.

1. **브리프는 모호하게.** 방법을 적으면 분해가 이미 끝나버린다.
2. **성공 조건 보기에 함정을 섞는다.** `trap: 'hardcode'`(이번 결과를 성공으로 삼는 문장),
   `trap: 'luck'`(오류만 없으면 성공). 어느 게 맞는지 화면에서 절대 알려주지 않는다.
3. **마지막 입력은 반드시 반례.** `counter: true`. 다섯 축 중 하나를 건드린다 —
   개수 변화 / 구분자 변화 / 빈 결과 / 보이지 않는 차이(앞뒤 공백) / 경계값(기준과 정확히 같은 값 —
   `>` 와 `>=` 가 갈리는 값, 첫·마지막 원소, 0, 길이 1).
4. **통과 조건(`goalLabel`)은 결과로만 쓴다.** 방법을 적으면 정답 공개다.
   "조각 안에 더 쪼갤 게 남지 않았는가" (O) / "쉼표로 나눴는가" (X)

`support` 단계를 올릴 때는 보기를 걷어낸다. 지원은 끄는 게 아니라 단계적으로 걷어낸다.

### 블록을 늘릴 때

> **새 블록은 새로운 판단을 요구할 때만 추가한다.** 같은 판단의 변형이면 넣지 않는다.

"슬래시로 자르기" 는 만들지 않는다 — `cut` 의 기준 값만 다르다.
`trim` 은 있다 — "눈에 안 보이는 차이" 라는 새 판단을 데려오기 때문이다.

**한계선은 12개.** 넘겨야 할 것 같으면 블록을 늘릴 때가 아니라 과목을 나눌 때다.
자세한 건 `docs/semester.md`.

---

## 파일 구조

화면 8개와 **세 층**으로 나뉜 코드. 층의 경계가 이 저장소에서 제일 중요한 규칙이다.

```
index.html      학생 화면 (미션 01·02·03·06 + 졸업 과제, 블록 기반)
sentence.html   학생 화면 (문장형 미션 01, 선택형 빈칸)
abstract.html   미션 04 · 추상화
review.html     미션 05 · 동료 검토
make.html       졸업 시험 · 내 미션 만들기
teacher.html    선생님 화면
print.html      수업 준비물 (인쇄용)
admin.html      관리자 화면 (강사별 생성 한도 · 최근 생성 기록, 관리자만)
philosophy.html 철학 한 장 (리뷰·심사용)
slide2.html     발표 슬라이드 (설문은 slide2-data.js, 시연 두 칸은 window.name 으로 세션을 나눈다)

js/core/   판단의 규칙. 저장소도 네트워크도 화면도 모른다
  events.js     이벤트 계약 + "저장하지 않기로 한 필드" 차단
  fold.js       이벤트 → 학생 한 명 (순수 함수)
  engine.js     실행 엔진 + Python 변환
  blocks.js     논리 블록 카탈로그
  missions.js   미션 데이터
  hangul.js     조사 계산
  llmguard.js   LLM 출력 검사기
  asks.js       AI 되묻기 문장
  compass.js    나침반 그림(바늘·다각형 SVG 문자열) · 방위 이름

js/data/   바깥 세계. 여기만 localStorage 와 fetch 를 안다
  config.js     apiBase 가 비면 로컬, 있으면 서버
  api.js        local / http 어댑터
  store.js      오프라인 우선 기록 + 발신함
  prefs.js      이 브라우저의 보기 편의(사이드바 접힘 · 고른 탭) — 기록이 아니다
  checks.js     선생님이 확인한 알림 — 서버면 DB(alert_checks), 없으면 localStorage

js/ui/     화면. DOM 만 만진다
  app.js  teacher.js  abstract.js  review.js  make.js  classroom.js  sentence.js  admin.js
  kit.js        공용 화면 조각(el · esc · 칩 · 접는 줄 · 안내 상자 · 코드 블록) — 스타일은 kit.css
```

### 층을 넘지 않는다

| 층 | 알아도 되는 것 | 알면 안 되는 것 |
|---|---|---|
| `core` | 순수 자바스크립트 | `localStorage` · `fetch` · `document` · `window` |
| `data` | `core`, 브라우저 저장소, 네트워크 | `document` |
| `ui` | `core`, `data`, DOM | 서버가 있는지 없는지 |

`test/layer.test.js` 가 이걸 자동으로 검사한다. `core` 안에서 `localStorage` 를
한 번 쓰는 순간 테스트가 깨진다 — 말이 아니라 테스트가 경계를 지킨다.

**접기(fold)는 한 곳에만 있는다.** 서버의 `board` 응답도 같은 접기를 하므로,
규칙이 두 군데 생기면 반드시 갈라지고, 갈라진 날 교사 화면은 학생이 한 것과
다른 걸 보여준다. 서버는 `js/core/fold.js` 를 옮겨 쓰지 않고 **옮겨 심는다**.

### 새 이벤트를 더할 때

1. `js/core/events.js` 의 `T` 에 상수를 더한다. 화면에서 문자열을 직접 쓰지 않는다 —
   오타는 에러 없이 통과해서 교사 화면에서만 사라지고, 그 버그는 수업 중에 발견된다.
2. `js/core/fold.js` 의 `apply()` 에 `case` 를 더한다.
3. `NEVER` 목록에 걸리는 필드를 담지 않는다. 점수·정답률·순위는
   문서가 아니라 `events.make()` 가 예외로 거절한다.
4. `type` 을 더하는 건 스키마 버전을 올리지 않는다. 기존 `type` 의 **의미가 바뀔 때만** 올린다.

### 서버를 붙일 때

`js/data/config.js` 의 `apiBase` 한 줄. 화면 코드는 하나도 안 바뀐다.
**서버를 필수로 만들지 않는다** — 학교 와이파이는 끊기고, 끊긴 순간 학생이 누른 게
사라지면 그 수업은 거기서 끝난다. 서버는 기록의 조건이 아니라 기록의 사본이다.

- 학생 계정은 선생님이 만든다 — `api/create-student.py` + Vercel 환경변수 셋
  (`SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`)이 있어야 한다.
  서버가 없어도 로컬 모드의 수업 흐름은 그대로 돈다. 자세한 건 `docs/server.md` 8절.

빌드도 의존성도 없다. 정적 파일만 쓴다. **번들러를 도입하지 않는다** —
교사가 파일을 열어보고 고칠 수 있어야 한다.
**ES 모듈(import/export)도 쓰지 않는다** — `file://` 에서 CORS 로 막힌다.

---

## 작업 순서

```bash
python3 -m http.server 8123 &

node test/engine.test.js     # 반례가 실제로 깨지는지, 에러가 몇 번 블록을 짚는지
node test/hangul.test.js     # 조사
node test/llmguard.test.js   # AI 출력 규칙 + 우리가 쓰는 문장이 그 규칙을 지키는지
node test/layer.test.js      # 계층 경계 + 이벤트 계약 + 접기
node test/alerts.test.js     # 교사 알림 — 종류별 한 번 · 확인할 때까지 남음 · 켠 시각 이전은 확인 · 사실 문장
node test/smoke.js           # 10개 화면 × 3폭 × 2테마, JS 에러 / 가로 스크롤 / 금지 단어
node test/robust.js          # 학생 자유 입력이 선생님 화면까지 안전하게 흐르는지
node test/compass.test.js    # 미션 마침 알림은 학생·미션당 한 번 · 나침반 SVG · 방향 모양
node test/shots.js           # 수업-흐름 그림 다시 찍기 (가짜 데이터)
node test/slide2.test.js     # 발표(/slide2)에 옮겨 적은 수가 코드와 같은지 · 설문 데이터 꼴

# 미션 생성 서버(api/*.py) — venv 없이 uv 가 pydantic 을 준비한다
uv run --with-requirements requirements.txt python test/test_missionguard.py     # 생성 미션 검사 + 우리 미션 문장
uv run --with-requirements requirements.txt python test/test_pipeline_parity.py  # JS·Python 엔진이 같은 답을 내는지
uv run --with-requirements requirements.txt python test/test_generate.py         # LLM 을 가짜로 끼워 재요청·칸별 폴백 흐름
uv run --with-requirements requirements.txt python test/test_accounts.py         # 학생 계정 만들기 — 남의 교실·중복 아이디·키 노출
uv run --with-requirements requirements.txt python test/test_steps.py            # 단계별 생성 — 개념 낱말 규칙·예시 거르기·초안 검사·재요청·강사만
uv run --with-requirements requirements.txt python test/test_tutor_recap.py      # 수업에서 짚을 거리 — 항목 검사·인용 대조·상한·재요청·강사만
uv run --with-requirements requirements.txt python test/test_quota.py            # 강사별 생성 한도 — 예약·반환·재요청 ticket·0개면 403·네트워크 실패
uv run --with-requirements requirements.txt python test/test_admin.py            # 관리자 API — 관리자만·한도 0..1000 정수·낮춰도 left 0·목록·로그
uv run --with-requirements requirements.txt python test/test_compass.py          # 나침반 규칙 — 체크 12항목·인용 대조·최근 5개 가중 평균·상쇄 후보·선생님 선택
uv run --with-requirements requirements.txt python test/test_compass_api.py      # 나침반 API — 내 교실만·한 번만 읽기·누적·상쇄 때 고른 방향·학생에게 안 가는 열
uv run --with-requirements requirements.txt python test/test_tutorguard.py      # 튜터 — 문법은 주고(이름·생김새·상관없는 예시 2줄) 미션 자료에 붙인 코드는 막기
uv run --with-requirements requirements.txt python test/test_alert_checks.py    # 알림 확인 RLS — 본인 행·자기 교실만, 학생·anon 불가 (PostgreSQL 이 있으면 임시 DB 로 실제 검사)

npx playwright test                # 화면 흐름 e2e (서버 8123) — 나침반 카드·상쇄 고르기·레벨 테스트 문제지·재테스트 알림
```

8123 을 다른 작업 폴더가 쓰고 있으면 `CC_BASE=http://localhost:8125 node test/smoke.js` 처럼 주소를 바꾼다.

위 테스트가 모두 통과해야 커밋한다. `js/core/pipeline.js` 를 고치면 `api/_pipeline.py` 도 같이 고친다.
브라우저 경로가 다르면 `CC_CHROME=/path/to/chrome node test/smoke.js`.

학생의 자유 입력(직접 쓴 성공 조건, 마무리 문장, 만든 미션)은 **반드시 교사 화면에
그대로 올라간다.** 새 자유 입력 칸을 만들면 `test/robust.js` 경로에 추가한다.

---

## 문제가 생기면

1. **먼저 [docs/트러블슈팅.md](docs/트러블슈팅.md) 를 찾는다.** 같은 증상이 있으면 적힌 해결법을 따른다.
2. 없으면 직접 해결한다.
3. 해결을 **실제로 확인한 뒤** 그 파일에 증상 · 원인 · 해결 · 확인 방법을 추가한다.
   해결 못 한 문제나 추측은 적지 않는다.

같은 문제를 두 번 조사하는 비용이 기록하는 비용보다 훨씬 크다.

## 커밋 메시지

무엇을 바꿨는지보다 **왜 그렇게 결정했는지**를 적는다.
6개월 뒤에 "이건 왜 이렇게 돼 있지"를 막는 게 이 저장소에서 제일 비싼 정보다.

거절한 선택지가 있으면 그것도 적는다. 같은 제안이 반드시 다시 올라온다.
