# 디자인 시스템 전·후 숫자

| 항목 | 이전 | 이후 | 줄어든 정도 |
|---|---|---|---|
| detail-js-lines (teacher.js 학생 상세 함수 8개 몸통) | 554 | 367 | -187 (-34%) |
| detail-css-rules (teacher.css 상세 관련 규칙 줄) | 112 | 100 | -12 (-11%) |
| helper-defs (`var el = function` + `function esc(s`) | 10 | 9 | -1 |
| dup-class-defs (같은 클래스를 정의한 css 파일 수, 칩 계열) | 6 | 6 | 0 |
| files-to-restyle-chip (칩 모양을 바꾸려면 고칠 파일) | 2 | 2 | 0 (아래 참고) |
| **새로 생긴 코드: `js/ui/kit.js`** | 0 | 67 | +67 줄 |
| **새로 생긴 코드: `kit.css`** | 0 | 26 | +26 줄 |

늘어난 것: kit 파일 93줄. teacher.js 가 187줄 줄었으므로 두 파일 합친 순 감소는 약 94줄이지만(상세 css 는 별도로 -12), 앞으로 이 조각을 쓰는 화면이 있어야 본전이 난다.

줄어들지 않은 항목의 이유:
- helper-defs -1 뿐: teacher.js 의 `el` · `esc` 두 정의가 kit 으로 옮겨 갔지만(-2), kit.js 의 `esc` 가 새로 한 줄을 센다(+1). kit.js 의 `el` 은 `function el` 이라 정의가 세는 모양이 아니다. 학생 화면 5곳(`el` 5 · `esc` 3)은 이번에 건드리지 않았다.
- dup-class-defs 6 · files-to-restyle-chip 2: 학생 화면의 `.tag` · `.badge` 계열과 css 가 그대로라 이번 범위(학생 상세)에서는 변하지 않는다. 새 칩 `.k-chip` 은 kit.css 한 곳에만 있다.

측정은 `node test/kit-metrics.js` (정의는 고치지 않는다), 이전 코드는 이 문서가 들어간 커밋의 부모에서 확인.

## 다른 화면 후보

목록만 쓴다. 이번에 바꾸지 않았고 학생 화면은 하나도 건드리지 않았다. 형식: 위치 — 지금 모습 — 대응하는 kit 조각.

### 헬퍼 중복 (`var el = function` 5곳 · `function esc(s` 3곳)
- js/ui/abstract.js:15, app.js:12, make.js:19, review.js:17, sentence.js:13 — 각자 `el(tag, cls, txt)` 정의 — kit.js 의 `el`
- js/ui/app.js:18, review.js:23, sentence.js:63 — 각자 `esc(s)` — kit.js 의 `esc`
- teacher.html:293-294 — 인라인 `el` · `esc`(세지 않는 곳) — kit.js 의 `el` · `esc`
- (kit.js 를 쓰려면 이 화면 html 에 `<script src="js/ui/kit.js">` 와 `kit.css` 링크가 필요하다)

### 카드류
- js/ui/app.js:483, 819 · abstract.js:279 · make.js:147 · review.js:184 — `.rescard`(+`.counter`) 결과 카드, styles.css:185 — 새로 필요한 것: 카드 조각(결과 카드 · 반례 변형)
- js/ui/app.js:893 — `.wrapcard`(styles.css:270) — 같은 카드 조각의 색 변형
- js/ui/review.js:305 — `.sentcard`(review.css:37) — 같은 카드 조각의 색 변형
- js/ui/review.js:68 — `.peercard` 버튼형 카드(review.css:5) — 카드 조각 + 버튼

### 버튼류
- `.btn`: app.js(4곳) · abstract.js · make.js · tour.js(3) 와 sentence/abstract/make/review/teacher.html, styles.css:128 · sentence.css:215 에 별도 정의 — 새로 필요한 것: 버튼 조각
- `.tbtn`: styles.css:68 · sentence.css:121 · 681 · 689 중복 정의, 사용은 teacher.js:942 · 947 과 각 html — 버튼 조각(작은 알약형)
- `.pill`: sentence.css:796 · teacher.css:54 · 197 · 419 · 499 에서 맥락마다 크기를 덮어씀, 사용은 teacher.js(8곳) · genflow.js · sentence.html · teacher.html — 버튼 조각의 크기 변수
- `.mbtn`: js/ui/app.js(2곳), styles.css:72 — 버튼 조각(카드형)
- `.iconbtn`: admin.html:20 · 27 · teacher.html(3곳), teacher.css:429 — 아이콘 버튼 조각

### 라벨류
- `.tag`: styles.css:245 · teacher.css:230 · 347 에서 각각 다른 모양 — 칩 `.k-chip`
- `.badge`: styles.css:78 — 칩 `.k-chip`
- `.mark`: abstract.css:19 · styles.css:64 · sentence.css:95 · teacher.css:436 — 같은 이름이지만 뜻이 다름(체크 칸 · 로고). 통합 대상이 아니라 이름 충돌이라 조심
- `.al-tag`: js/ui/teacher.js:1072, teacher.css:528 (알림 이름표) — 칩 `.k-chip` 변형

### admin.html · 선생님 명단 · 알림
- admin.html:20 · 27 — `.iconbtn` 햄버거 · 접기(teacher.css:429 를 공유) — 아이콘 버튼 조각
- js/ui/admin.js — 자체 `el`/`esc` 정의가 없어 헬퍼 중복은 없음. 표 · 한도 입력 모양은 별도 확인 필요
- js/ui/teacher.js:1072 — 알림의 `.al-tag` — 칩 조각
- 선생님 명단 줄(`.nr-row` 등, teacher.css:509 부근) — `.btn` 크기 덮어쓰기 — 버튼 조각
