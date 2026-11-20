# 실제 교실을 위한 서버 설계

지금 프로토타입은 `localStorage` 기반이라 **한 브라우저 안에서만** 학생↔교사가 연결된다.
26명이 각자 기기에서 하는 진짜 교실을 돌리려면 서버가 필요하다. (`docs/risks.md` 5번)

이 문서는 그 서버를 어떻게 만들지에 대한 설계다. **무엇을 저장하지 않을지가 절반이다.**

> **클라이언트 쪽 준비는 끝났다.** `js/` 가 `core / data / ui` 세 층으로 나뉘어 있고,
> 전송은 `js/data/api.js` 의 어댑터 뒤에 숨어 있다. 서버를 붙이는 작업은
> `js/data/config.js` 의 `apiBase` 를 채우는 것이고, 화면 코드는 한 줄도 안 바뀐다.

---

## 1. 설계 제약

이 서비스의 철학이 곧 스키마 제약이 된다.

| 제약 | 이유 |
|---|---|
| **정답 여부를 저장하지 않는다** | 컬럼이 있으면 언젠가 화면에 뜨고, 뜨면 줄 세우기가 시작된다 |
| **소요 시간을 순위로 쓸 수 있게 저장하지 않는다** | 같은 이유. 이벤트 타임스탬프는 남기되 집계 API 를 만들지 않는다 |
| 학생 식별은 **교실 안에서만** 유효하게 | 이름·학번을 서버에 두지 않는다. 좌석 별칭과 세션 토큰이면 충분하다 |
| 이벤트는 **추가만(append-only)** | 학생이 무엇을 언제 바꿨는지가 데이터의 본질이다. 갱신하면 그게 사라진다 |
| 수업이 끝나면 **원본 이벤트는 폐기 가능** | 남길 것은 집계된 교사용 리포트뿐이다 |

> 저장하지 않기로 한 것도 설계다. **없는 컬럼은 화면에 띄울 수 없다.**

---

## 2. 데이터 모델

```
classroom     교실(수업 한 타임)
  id            uuid
  code          6자리 입장 코드 (수업 시간에만 유효)
  mission_id    'm1' | 'm2' | ...
  opened_at     timestamptz
  closed_at     timestamptz  -- 닫히면 입장 불가, 이벤트 수신 중단

seat          좌석 = 학생 한 명 (개인정보 없음)
  id            uuid
  classroom_id  fk
  alias         '민서' 같은 표시용 별칭. 교사가 부여하거나 학생이 고름
  token         입장 시 발급, 이 교실에서만 유효

event         학생 행동 (append-only)
  id            bigserial
  seat_id       fk
  type          'define'|'cut'|'blocks'|'run'|'judge'|'cause'|'handle'
                |'help'|'revise'|'redefine'|'break'|'wrap'
                |'abstract-*'|'review-*'
  payload       jsonb
  at            timestamptz
```

인덱스는 `(classroom_id, at desc)` 와 `(seat_id, at desc)` 두 개면 된다.
교사 화면은 "최근 것부터" 만 본다.

### payload 에 들어가는 것

`js/core/events.js` 의 `T` 목록이 그대로 `type` 이 된다. 스키마를 새로 만들지 않는다.
클라이언트는 `events.make()` 를 거치지 않으면 이벤트를 만들 수 없고,
`NEVER` 목록(`score`·`rank`·`correct`·`duration`·`accuracy`·`level`·`streak`)에
걸리는 필드는 거기서 예외로 막힌다. **서버도 같은 목록을 거절 목록으로 쓴다.**

```json
{"type":"define","trap":"hardcode","text":"화면에 사과, 바나나, 우유 라고 뜨면 성공이다"}
{"type":"cut","sepName":"쉼표","why":"그냥 골랐어요","weak":true}
{"type":"help","exp":"여러 조각으로 나뉜 목록","act":"안 잘린 한 덩어리","blk":"2 · 기준으로 자르기"}
{"type":"redefine","from":"...","to":"...","trap":null}
```

**`correct`, `score`, `duration_rank` 같은 필드는 만들지 않는다.**

---

## 3. API

### 학생

```
POST /classrooms/{code}/seats
  → { seat_id, token, alias }
  입장 코드로 좌석을 받는다. 로그인 없음. 토큰은 그 교실이 닫히면 무효.

POST /seats/{seat_id}/events        Authorization: Bearer <token>
  body: { events: [ {type, payload, at}, ... ] }
  → 204
  배치로 보낸다. 네트워크가 끊겨도 학생 화면은 계속 돌아가야 하므로
  클라이언트는 localStorage 에 큐를 쌓고 재연결 시 flush 한다.
  (지금 프로토타입의 store.js 가 그 큐 역할을 이미 하고 있다)
```

멱등성: `(seat_id, at, type)` 로 중복 제거한다. 재전송이 흔한 구조라서 필요하다.

### 교사

```
GET  /classrooms/{id}/board          → 현재 상태 스냅샷
GET  /classrooms/{id}/stream         → SSE. 새 이벤트를 밀어준다
GET  /seats/{seat_id}                → 학생 한 명 상세
POST /classrooms/{id}/close          → 수업 종료
```

`board` 응답은 **교사 화면이 그리는 칸과 1:1로 맞춘다.**
프런트에서 다시 계산하게 두면 규칙이 두 군데로 갈라진다.

> **fold 는 옮겨 쓰지 않고 옮겨 심는다.**
> 이벤트를 학생 한 명으로 접는 규칙은 `js/core/fold.js` 하나뿐이다.
> 서버가 파이썬으로 같은 로직을 "다시 쓰면" 반드시 갈라지고, 갈라진 날
> 교사 화면은 학생이 실제로 한 것과 다른 걸 보여준다. 그게 이 제품에서
> 제일 비싼 버그다 — 수업 중에, 학생 앞에서 발견되기 때문이다.
>
> 그래서 셋 중 하나를 고른다.
> 1. 서버가 원본 이벤트를 그대로 내려주고 접기는 클라이언트가 한다 (`api.js` 가 이미 지원)
> 2. 서버가 `fold.js` 를 그대로 실행한다 (Node 사이드카 / QuickJS)
> 3. 파이썬으로 포팅하되 **같은 테스트 케이스**(`test/layer.test.js`)를 양쪽에서 돌린다
>
> 1번이 가장 싸고, 26명 규모에서는 충분하다. 3번을 고르면 테스트가 계약서다.

```json
{
  "ready":   [{seat_id, alias, exp, act, blk, idle_sec}],
  "half_asked": [...],
  "quiet":   [{seat_id, alias, stage, idle_sec}],
  "praise":  [{seat_id, alias, kind: "redefined"|"revised"|"self_found"}],
  "risky":   {"hardcode": [alias], "luck": [alias], "own": [alias]},
  "funnel":  [{stage, n}]
}
```

`praise` 의 정렬 순서는 서버가 정한다 — **redefined > revised > self_found**.
이 순서가 이 제품의 가치관이라서 클라이언트에 맡기지 않는다.

### 실시간

SSE 로 충분하다. 교사→학생 방향 통신이 없어서 WebSocket 이 필요 없다.
26명 × 이벤트 몇 십 개면 폴링(3초)으로도 되지만, 교사가 "지금" 개입해야 하는 제품이라
지연이 체감되면 안 된다.

---

## 4. 개인정보

- **이름·학번·연락처를 받지 않는다.** 좌석 별칭만 쓴다.
- 별칭조차 교사가 화면에서만 매핑한다 (종이 좌석표). 서버는 누가 누군지 모른다.
- 수업 종료 후 N일(기본 7일) 뒤 `event` 는 삭제하고, 교사용 요약만 남긴다.
- 요약에도 개인 식별자를 넣지 않는다 — "하드코딩 보기 선택 11명" 처럼 분포만 남긴다.

교육 현장은 개인정보 심사가 도입의 실질 관문이다.
**받지 않는 설계가 제일 싸게 통과한다.**

---

## 5. 학교 네트워크

- 학교 망에서 외부 도메인이 막히는 경우가 흔하다. **먼저 확인해야 한다.**
- 막히면 교사 노트북에서 도는 단일 바이너리(FastAPI + SQLite) 로 떨어뜨린다.
  학생 기기는 같은 Wi-Fi 의 로컬 IP 로 접속한다. 이 구조가 오히려 개인정보 심사에 유리하다.
- 정적 파일(지금의 5개 화면)은 그대로 서빙하면 된다. 빌드가 없는 게 여기서 이득이 된다.

---

## 6. 단계적으로 만든다

| 단계 | 무엇 | 왜 이 순서인가 |
|---|---|---|
| 0 | 지금 (localStorage, `api.js` 의 local 어댑터) | 시연과 리뷰에는 충분하다 |
| 1 | `POST /events` + `GET /board` 폴링 | 한 교실을 실제로 돌려보는 최소 단위 |
| 2 | `GET /stream` (SSE) | 개입 타이밍이 체감되기 시작하면 |
| 3 | 여러 교실·차시 관리 | 두 번째 학교부터 필요하다 |

1단계에서 클라이언트가 할 일은 `config.js` 의 `apiBase` 를 채우는 것뿐이다.
`js/data/store.js` 의 발신함(outbox)이 이미 오프라인 우선으로 동작한다 —
항상 로컬에 먼저 쌓고, 서버로는 뒤에서 보내고, 실패하면 지우지 않고 다시 시도한다.

**1단계까지만 있어도 첫 수업은 돌아간다.** 거기서 얻는 데이터가
`docs/survey.md` 의 가설 H1~H5 를 검증한다. 2·3단계는 그다음이다.

---

## 7. 서버를 만들면서도 지킬 것

새 기능을 서버에 넣을 때 `CLAUDE.md` 의 질문을 그대로 쓴다.

> 이건 시작 비용을 줄이는 건가, 판단을 대신하는 건가?

서버에서 특히 유혹이 큰 것들 —

- **"정답률 API 하나만"** → 만들지 않는다. 한 번 만들면 화면에 뜬다.
- **"학생 랭킹 조회"** → 만들지 않는다.
- **"AI 자동 힌트 푸시"** → 학생이 증상을 말하기 전에는 아무것도 보내지 않는다.
- **"교사 대신 칭찬 메시지 발송"** → 타이밍만 알린다. 문구는 만들지 않는다.
- **"서버가 있어야 수업이 된다"** → 그렇게 만들지 않는다. 학교 와이파이는 끊기고,
  끊긴 순간 학생이 누른 게 사라지면 그 수업은 거기서 끝난다.
  **서버는 기록의 조건이 아니라 기록의 사본이다.**

---

## 8. 지금 쓰는 계정 — Supabase (2026-10-18)

위 1~7 은 처음 설계다. 지금 배포본은 Supabase 인증 + `api/create-student.py` 로 돈다.

- **강사**: `auth.html` 에서 이메일로 스스로 가입한다. 스스로 가입한 사람은 모두 강사다.
- **학생**: 스스로 가입하지 않는다. 선생님 화면 `학생 추가` 탭에서 선생님이 이름·아이디·비밀번호로 만든다.
  학생은 `auth.html` 에 **아이디 + 비밀번호** 로 들어온다. 내부 이메일은 `<아이디>@students.invalid`.
  아이디: 영어 소문자·숫자·`-`, 3~30자. 비밀번호를 비우면 서버가 8자를 만든다(헷갈리는 0/o·1/l/i 제외).
- **교실 코드로 스스로 들어가기는 없앴다.** 수강(enrollments) 줄은 서버만 만든다.
- **역할은 서버가 정한다.** `app_metadata.role = 'student'` 이고 이메일이 `@students.invalid` 일 때만 학생,
  그 밖에는 강사다. GoTrue 는 `app_metadata` 를 INSERT 가 아니라 뒤따르는 UPDATE 에서 넣으므로,
  `handle_new_user`(INSERT)는 우선 강사 행을 만들고 `handle_student_role`(UPDATE OF raw_app_meta_data)이 학생 + `login_id` 로 바꾼다.
  `app_metadata` 는 service role 키로만 쓸 수 있다. `user_metadata.role` 은 보지 않는다.
  공개 가입으로 학생 이메일을 먼저 차지한 계정은 만들기 때 서버가 지우고 한 번만 다시 만든다.
  `profiles` 는 본인도 `name` 열만 고칠 수 있다(열 단위 권한) — 학생이 스스로 강사가 되는 길을 막았다.

```
POST /api/create-student        Authorization: Bearer <선생님 access token>
  { action: 'create', classroomId, name, loginId, password? } → { loginId, password }
  { action: 'reset',  classroomId, loginId, password? }       → { loginId, password }
  401 토큰 없음·무효 / 403 강사 아님·이 교실 선생님이 아님(reset: 이 교실 학생이 아님) / 409 이미 있는 아이디
  400 입력 형식(classroomId 는 UUID) / 502 Supabase 실패·시간 초과(수강 넣기가 실패하면 만든 계정을 지운다) — 모두 { error: '<선생님에게 보일 한국어 문장>' }
```

환경변수(Vercel): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. 값은 저장소에 두지 않는다.
관리자 API(`/api/admin`)는 환경변수 `ADMIN_EMAILS`(쉼표로 구분한 이메일, 대소문자·공백 무시)에 있는 선생님만 쓴다. 비어 있으면 아무도 못 쓴다. 값은 저장소에 두지 않는다.
서버가 없으면(로컬 모드) 계정은 못 만들지만 수업 흐름은 그대로 돈다.

### 미션 만들기 API — `api/mission-steps.py` · `api/generate-mission.py`

강사 화면의 단계별 생성(개념 확인 → 예시 → 만들기)은 `POST /api/mission-steps` 하나가 `action` 으로 나뉘어 받는다. 빠른 생성은 `/api/generate-mission` 그대로다.

```
POST /api/mission-steps         Authorization: Bearer <선생님 access token>
  { action: 'concept',  lesson, keyPoint }                                   → { concept, label, by }
  { action: 'examples', concept, seen, difficulty, stages }                  → { examples: [{ title, situation, why }] }
  { action: 'build',    concept, example, wish, problems, difficulty, stages, ticket? } → { draft, ticket, left }
  { action: 'solve',    situation, brief, inputs }                           → { code }
  { action: 'quota' }                                                        → { left, disabled }
  401 토큰 없음·무효 / 403 강사 아님·생성 횟수 없음(left: 0) / 400 입력 형식 / 422 규칙 검사 탈락(reasons 포함) / 502 LLM·Supabase 실패·시간 초과
```

- **두 함수 모두 Bearer 토큰이 필요하다.** `mission-steps` 와 `generate-mission` 은 같은 확인(`api/_auth.py` 의 `refuse`)을 거친다. 토큰이 없거나 강사가 아니면 LLM 을 부르지 않는다. 로컬 모드(서버 없이 열기)에서는 호출이 로그인 안내로 돌아온다.
- **`tutor-recap`** (`POST /api/tutor-recap`, 수업에서 짚을 거리) 도 같은 강사 확인을 거친다. 학생 이름은 보내지 않고(`s1`, `s2` …), 돌아온 `quote` 는 입력의 질문과 글자 그대로 같은 것만 남는다. 실패는 502.
- **`compass`** (`POST /api/compass`, 나침반) — `list` · `analyze` · `send`. 강사 확인 뒤 그 교실의 담당인지, 학생이 그 교실에 있는지, 미션이 그 교실 것인지 본다(아니면 403). 이벤트는 서버가 service role 로 직접 읽는다 — 학생에게 갈 바늘의 근거를 강사 브라우저가 보낸 본문에 두지 않는다. AI 는 학생·미션당 한 번(`force` 는 "다시 읽기"). 생성 한도는 세지 않는다. `cumulative` 는 최근 5개 미션의 체크 12항목 · 튜터 질문 분포 · 누적 바늘(상쇄면 후보)을 강사에게 준다. `send` 의 `dir` 은 상쇄 때 선생님이 고른 방향(최신 미션에만). 학생은 RPC `compass_mine_v2`(누적 바늘 · 방위 · 길이 · 보낸 시각)와 `compass_note`(미션별 한마디)만 읽는다.
- **서버는 AI 가 쓴 코드를 실행하지 않는다.** `build` 가 돌려주는 모범 답안은 강사 브라우저(Pyodide)가 자료마다 돌려 정답을 얻는다. 로그인은 비용 남용을 막을 뿐 보안 경계가 아니다(이메일로 가입하면 누구나 강사) — 그래서 코드 실행을 서버에 두지 않았다.
- `solve` 는 모범 답안 없이 문제와 자료만 받아 따로 푼 코드를 돌려준다. 강사 화면이 같은 자료로 돌려 정답과 견준다.
- `build` 는 응답 시간 예산 55초(`maxDuration` 60초 안)를 강사 확인부터 센다. 규칙에 걸리면 이유를 붙여 재요청하며, 시간이 모자라면 재요청하지 않는다.
- **생성 한도(강사별).** `build` 1번과 빠른 생성(`generate-mission`) 1번이 각각 1개다. concept · examples · solve 는 세지 않는다. AI 를 부르기 전에 1을 예약하고(`api/_quota.py` → DB 함수 `gen_reserve`), 422 · 502 로 실패하면 돌려준다 — 그래서 성공한 것만 줄어든다. 남은 게 없거나 생성 끄기가 된 강사는 AI 를 부르지 않고 403 `{ error: '생성 횟수를 다 썼어요. 관리자에게 문의해 주세요.', left: 0 }`. 성공 응답에는 남은 수 `left` 가 붙는다.
  `build` 성공은 기록 행 id 를 `ticket` 으로 준다. 같은 초안을 다시 만들 때 그 `ticket` 을 보내면, 부른 강사의 것이고 재요청 2번 미만일 때만 세지 않고 만들며 같은 `ticket` 을 돌려준다. 아니면 새 미션으로 센다. 예약 RPC 가 시간 초과면 AI 를 부르지 않고 502, 성공 뒤 기록 · 실패 뒤 반환이 안 되면 로그만 남기고 응답은 그대로 보낸다(기록이 안 되면 `ticket` 이 빠진다). 기록 몫(3초)은 55초 안에서 미리 뺀다.
- **진행 단계 SSE (2026-11-20).** 두 함수 모두 `Accept: text/event-stream` 을 붙이면 같은 일을 하면서 지금 하는 일을 흘린다(`api/_progress.py`).
  ```
  event: step    data: {"code":"review","msg":"학생에게 내기 전에 검수하는 중이에요 (1차)","t":8.0}
  event: result  data: {"status":200,"body":{…JSON 응답과 같은 본문…}}
  : ping         (15초마다, 조용한 연결을 프록시가 끊지 않게)
  ```
  스트림이라 HTTP 상태는 늘 200 이고 진짜 상태(403 · 422 · 502)는 `result.status` 에 있다. 로그인 거절(401)과 본문 형식 오류(400)는 스트림을 열기 전에 JSON 으로 끝난다.
  강사 화면은 `CC.sb.stream` → `CC.sse.post`(`js/data/api.js`)로 부르고 Content-Type 으로 갈라 읽는다 — 예전 서버나 스트림이 막힌 망이면 JSON 으로 받아 결과는 같다. 단계 문장은 강사 화면에만 뜬다(`js/ui/genprogress.js`).
  단계 code: 빠른 생성 `choose` → `draft` → (`fix`) → `review` → (`regen` → `review`), 만들기 `draft` → (`fix`). 연결이 중간에 끊겨도 일은 끝까지 간다 — 생성 한도 기록 · 반환이 일 안에 있어서다.
  Vercel Python 함수는 스트리밍이 기본으로 켜져 있다([changelog](https://vercel.com/changelog/python-vercel-functions-now-have-streaming-enabled-by-default)). 첫 배포 뒤 강사 화면에서 단계가 하나씩 뜨는지 확인한다 — 한꺼번에 뜨면 버퍼링된 것이고, 결과는 그래도 같다.

환경변수(Vercel), 둘 다 비워 두면 기본값이다.

| 이름 | 기본값 | 쓰는 곳 |
|---|---|---|
| `LLM_MODEL` | `openai/gpt-5.4` | 만들기(모범 답안 포함)와 빠른 생성 |
| `LLM_MODEL_LIGHT` | `openai/gpt-5.4-mini` | 개념 확인 · 예시 · 따로 풀기 — 비용을 줄이려고 단계별로 나눴다 |

그 밖에 위 `SUPABASE_*` 셋이 있어야 강사 확인이 된다. 없으면 502 "서버에 계정 설정이 없어요".
`generate-mission` 도 이번 브랜치부터 같은 셋 + 강사 로그인이 필요하다 — 예전처럼 토큰 없이 부르던 도구(`debug.html` 의 AI 테스트 포함)는 `CC.sb.api` 로 토큰을 붙여야 한다. 로그인 안 한 창에서는 401 이다.

### 배포 순서 — 마이그레이션이 코드보다 먼저

`js/data/supabase.js` 가 `enrollments.onboard_due` 를 select 한다. 열이 없으면 Supabase 가 에러를 돌려주고,
강사 화면의 명단·학생 화면의 교실 목록이 **비어 보인다**(에러 화면이 아니라 빈 목록이라 수업 중에야 발견된다).

1. `supabase/migrations/20261019000000_assign_level_test.sql` 을 운영 DB 에 먼저 적용한다 (`supabase db push` 또는 SQL 편집기).
2. 적용됐는지 본다: `select onboard_due from enrollments limit 1;` 이 에러 없이 돈다.
3. 그다음 코드를 배포한다 (Vercel). 거꾸로 하면 1~3 사이 모든 교실이 빈 명단이다.
4. Vercel 환경변수 `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` 가 있어야
   `mission-steps` 와 `generate-mission` 이 돈다(없으면 502).

#### 생성 한도 — `20261020000000_gen_quota.sql`

`build` 와 빠른 생성은 AI 를 부르기 전에 DB 함수 `gen_reserve` 로 1을 예약한다. 함수가 없으면 예약이 실패하고,
**모든 생성이 502** 다. 일부러 이렇게 막아 뒀다(fail-closed) — 예약 RPC 가 안 될 때 그냥 통과시키면
DB 장애 한 번에 비용 한도가 통째로 풀린다. 그래서 순서가 중요하다.

1. `supabase/migrations/20261020000000_gen_quota.sql` 을 운영 DB 에 적용한다 (`supabase db push` 또는 SQL 편집기).
2. 적용됐는지 본다: SQL 편집기에서 `select * from gen_left('<강사 uuid>');` 가 `quota · used · disabled` 한 줄을 돌려준다
   (행이 없는 강사는 기본값 3 · 0 · false).
3. Vercel 환경변수 `ADMIN_EMAILS` 를 넣는다 — **필수.** 이미 가입한 선생님 계정의 이메일만, 쉼표로 구분한다.
   값은 저장소·문서·커밋 어디에도 적지 않는다. 비워 두면 관리자 화면(`admin.html`)을 아무도 못 쓰고,
   그러면 누구의 기본 한도 3개도 늘릴 수 없다 — 첫 수업 날 강사가 3개를 다 쓰면 거기서 멈춘다.
4. 그다음 코드를 배포한다 (Vercel). 코드가 먼저 나가면 1 이 끝날 때까지 모든 생성이 502 다.

#### 나침반 — `20261021000000_compass.sql`

테이블 `compass` 와 RPC `compass_mine` 이 없으면 강사 화면의 나침반 카드가 "지금은 읽지 못했어요" 에 머물고,
학생 카드는 안 보인다(수업 흐름은 그대로). 그래도 마이그레이션을 먼저 적용한다.

1. `supabase/migrations/20261021000000_compass.sql` 을 운영 DB 에 적용한다.
2. 확인: anon 키로 `rest/v1/compass?select=*` 가 빈 목록, `rpc/compass_mine` 이 401 이다.
3. 그다음 코드를 배포한다.

#### 나침반 2차 — `20261022000000_compass_v2.sql`

`compass` 에 `checks` · `tutor_dirs` · `student_view` · `done_at` 열을 더하고 `levels` · `evidence` 의 NOT NULL 을 푼다.
학생 RPC `compass_mine_v2()`(누적 바늘 · 방위 · 길이 · 보낸 시각)와 `compass_note(mid)`(한마디 · 보낸 시각)를 만든다.
1차 `compass_mine` 은 배포 사이 옛 화면을 위해 남긴다. 코드가 먼저 나가면 강사 카드가 "지금은 읽지 못했어요" 에 머문다.

1. `supabase/migrations/20261022000000_compass_v2.sql` 을 운영 DB 에 적용한다.
2. 확인: anon 키로 `rpc/compass_mine_v2` · `rpc/compass_note` 가 401, `rest/v1/compass?select=*` 가 빈 목록이다.
3. 그다음 코드를 배포한다. 1차 행(`checks` 없음)은 강사 화면이 처음 열 때 한 번씩 다시 읽는다(AI 호출, 생성 한도와 무관).

#### 레벨 테스트 문제지 — `20261023000000_onboard_set.sql`

`enrollments.onboard_set`('low'|'mid'|'high') 과 RPC `assign_onboard2(cid, sid, assign, qset)` 을 만든다.
**코드가 먼저 나가면 학생 교실 목록과 강사 명단이 빈 채로 온다**(없는 열을 고르기 때문) — 반드시 마이그레이션이 먼저다.
옛 `assign_onboard` 는 배포 사이 옛 화면을 위해 남긴다(문제지를 바꾸지 않음).

1. `supabase/migrations/20261023000000_onboard_set.sql` 을 운영 DB 에 적용한다.
2. 확인: `select onboard_set from enrollments limit 1;` 이 에러 없이 돈다. anon 키로 `rpc/assign_onboard2` 가 401 이다.
3. 그다음 코드를 배포한다.

#### 알림 확인 — `20261024000000_alert_checks.sql`

테이블 `alert_checks`(teacher_id · classroom_id · alert_key · checked_at, 기본 키 셋) 와 RPC `alert_checks_since()` 를 만든다.
RLS — 선생님 본인 행 · 자기 교실만 읽고 쓴다. 학생 · anon 은 읽지도 쓰지도 못한다. 알림 자체는 저장하지 않는다(화면이 기록에서 계산).
`alert_checks_since()` 는 **마이그레이션을 적용한 시각**을 상수로 돌려준다 — 그 전에 생긴 일은 확인한 것으로 친다(첫날 몇 주 치가 쏟아지지 않게).
그래서 적용 시각이 곧 기준이다. 코드 배포 직전에 적용한다. 다시 적용하면 기준이 그 시각으로 옮겨간다.
코드가 먼저 나가면 강사 화면이 확인 목록을 못 읽어 '연 뒤에 생긴 일만' 띄우고, 확인 버튼은 저장되지 않는다(다음에 열면 다시 뜬다). 수업 흐름은 그대로.

1. `supabase/migrations/20261024000000_alert_checks.sql` 을 운영 DB 에 적용한다.
2. 확인: `select alert_checks_since();` 가 적용한 시각을 돌려준다. anon 키로 `rest/v1/alert_checks?select=*` 가 401(권한 없음), `rpc/alert_checks_since` 가 401 이다.
3. 그다음 코드를 배포한다. 로컬 확인: `python test/test_alert_checks.py` 가 임시 PostgreSQL 에서 RLS 를 돌려 본다.

