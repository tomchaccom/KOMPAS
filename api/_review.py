"""생성 직전 LLM 검수와 재생성 루프.

학생이 볼 문장과 자료 그대로 넘겨 ITEMS 를 묻는다. 탈락하면 이유를 붙여 처음부터 다시 만든다
(최대 2번). 그래도 탈락하거나 시간이 모자라거나 검수를 못 하면 교사 검수로 넘긴다 — 내보낼지는
교사가 정한다 (사람 결정 2026-10-16). 검수 문장은 교사 화면에만 간다.
"""
import json
import sys
import time

from _generate import DEADLINE, _json, generate, pickle_llm
from _progress import step

MAX_REGEN = 2
REGEN_NEEDS = 25   # 초. 다시 만들고(~8초) 다시 검수(~3초)할 여유
REVIEW_NEEDS = 5   # 초. 이만큼도 없으면 검수 없이 교사에게
REVIEW_TIMEOUT = 20  # 초. 검수 실측 3~5초 + 504(~8초) 뒤 한 번 더

ITEMS = {
    'understand': '중1이 요청을 읽고 무엇을 구해야 하는지 아는가',
    'sameStory': '세 자료가 같은 이야기인가 (과일 목록과 문구 목록이 섞이면 아니다)',
    'noAnswer': '요청·상황 문장(이야기 포함)에 답이나 푸는 방법("겹쳐도 한 번만 세어" 같은)이 드러나지 않았나 (성공 조건 보기는 보지 않는다)',
    'easy': '쉬운 말로 짧게 썼나',
    # 2026-10-18 '간식 세기' 조사에서 위 넷을 다 통과한 채 나간 것들
    # 구할 값의 종류만 본다. 요청 속 '할 일'(몇 가지 살지 정하기)을 정답 보기와 맞대 떨어뜨린 오탈락이 있었다 (2026-10-18)
    'sameAsk': ('요청이 알아내라는 값과 정답 보기의 값이 엇갈리지 않는가. 요청 뒤쪽의 할 일(무엇을 정하기·사기)은 비교하지 않는다. '
                '탈락은 "몇 가지"(겹친 것은 한 번만) ↔ "모두 몇 개"(겹친 것까지 전부)처럼 같은 목록을 다르게 세는 엇갈림뿐이다. '
                '맞는 예: 요청 "간식마다 몇 번씩 나왔는지 봐서 몇 가지 살지 정해 주세요" ↔ 정답 "간식마다 몇 번 나왔는지가 나오면 성공". '
                '틀린 예: 요청 "준비물이 몇 가지인지 알려 주세요" ↔ 정답 "준비물이 모두 몇 개인지 나오면 성공"'),
    'noFieldName': '학생이 보는 문장에 itemName·filterTarget 같은 영어 칸 이름이 그대로 나오지 않았나',
    'cleanData': '자료의 "항목" 값 안에 자료 "이름"("민지 쪽지" 같은)이나 목록 이름이 항목으로 끼어들지 않았나. "이름" 칸은 항목이 아니다',
}
SCHEMA = {
    'type': 'object',
    'properties': {k: {'type': 'object', 'description': v,
                       'properties': {'ok': {'type': 'boolean'}, 'why': {'type': 'string', 'description': '교사에게 한 문장'}},
                       'required': ['ok', 'why'], 'additionalProperties': False} for k, v in ITEMS.items()},
    'required': list(ITEMS), 'additionalProperties': False,
}
SYSTEM = '\n'.join([
    '당신은 중학교 1학년 수업에 쓸 문제를 학생에게 내기 직전에 검수한다.',
    '학생이 볼 문장과 자료만 보고 항목마다 ok 와 이유 한 문장을 쓴다.',
    "'성공 조건 보기'는 코드가 붙인 후보다. 진짜 보기와 함정 보기가 일부러 섞여 있으니 답이 드러났다고 보지 않는다.",
    "'정답 보기'는 학생에게 진짜인지 알리지 않는 보기다. sameAsk 는 요청과 정답 보기만 비교한다.",
    "'고정 목록'은 학생에게 자료처럼 보이는 목록이다(한 사람의 목록 등).",
    'noAnswer 는 요청·상황 문장만 본다.',
    # 2026-10-17 eval 2회차: 반례의 다른 항목을 '다른 이야기' 로 잡아 교사 검수로 넘겼다 (사람 결정으로 추가)
    '셋째 자료는 반례다. 앞 두 자료로 세운 기준이 깨지게 항목 수나 일부 항목이 일부러 다르다. '
    '걸러낼 항목만 모아 결과가 비게 만든 반례(예: 숫자 없이 낱말만)도 있다. '
    '그것만으로 sameStory 를 탈락시키지 않는다 — 상황 자체가 다를 때(과일 목록 뒤에 문구 목록)만 탈락이다.',
    *[f'- {k}: {v}' for k, v in ITEMS.items()],
    'JSON 하나만 응답한다.',
])


def review(mission, call_llm, timeout):
    """→ 걸린 이유 목록. 빈 목록이면 통과. 응답이 JSON 이 아니면 ValueError."""
    shown = {  # guard · 함정 표시는 넘기지 않는다 — 학생이 보는 것만 (정답 보기는 sameAsk 비교용으로 따로 짚는다)
        '제목': mission.get('title', ''), '요청': mission.get('brief', ''), '상황': mission.get('situation', ''),
        # '이름: 값' 한 줄로 주면 검수가 이름을 항목으로 읽어 cleanData 를 매번 탈락시켰다 (2026-10-18 eval 3/3)
        '자료': [{'이름': i['name'], '항목': i['v']} for i in mission.get('inputs', [])],
        '성공 조건 보기': [o['v'] for o in mission.get('define', {}).get('options', [])],
        '정답 보기': next((o['v'] for o in mission.get('define', {}).get('options', []) if o.get('key')), ''),
    }
    ft = (mission.get('pipelineParams') or {}).get('filterTarget')
    if ft:
        shown['고정 목록'] = f"{mission.get('filterDesc', '')}: {','.join(ft)}"
    raw = call_llm([{'role': 'system', 'content': SYSTEM},
                    {'role': 'user', 'content': json.dumps(shown, ensure_ascii=False)}], SCHEMA, timeout)
    d = _json(raw)
    if not isinstance(d, dict):
        raise ValueError('검수 응답이 JSON 이 아님')
    out = []
    for k, label in ITEMS.items():
        v = d.get(k)
        if not isinstance(v, dict) or not isinstance(v.get('ok'), bool):
            raise ValueError(f'검수 항목 {k} 이 빠졌거나 ok 가 불리언이 아님')
        if not v['ok']:
            out.append(f"{label.split(' (')[0]} — {v.get('why') or '답이 없어요'}")
    return out


def make_mission(lesson, key_point, call_llm=pickle_llm, level=None, t0=None):
    t0 = t0 or time.monotonic()  # 핸들러가 강사 확인·예약 시간까지 셀 수 있게
    left = lambda: DEADLINE - (time.monotonic() - t0)  # noqa: E731
    m, feedback, rounds, status, reasons = None, None, 0, 'teacher', []
    while True:
        try:
            m = generate(lesson, key_point, call_llm, feedback=feedback, t0=t0, level=level)
        except Exception as e:  # noqa: BLE001 — 첫 판은 그대로 던지고, 다시 만들다 실패하면 앞 초안을 살린다
            if m is None:
                raise
            print('[generate-mission] 다시 만들기 실패', repr(e), file=sys.stderr)
            reasons = reasons + ['다시 만들기에 실패해서 앞 문제를 보여 드려요']
            break
        if left() < REVIEW_NEEDS:
            reasons = ['검수할 시간이 모자랐어요']
            break
        rounds += 1
        step('review', f'학생에게 내기 전에 검수하는 중이에요 ({rounds}차)')
        try:
            # 게이트웨이가 8초쯤 504 를 내면 _post 가 한 번 다시 보내는데, 15초 예산이면 남은 7초에 또 끊겼다
            # (2026-10-18 eval 8회 중 3회 '검수를 못 했어요'). 다시 보낼 몫까지 20초.
            reasons = review(m, call_llm, min(REVIEW_TIMEOUT, left()))
        except Exception as e:  # noqa: BLE001 — 504·JSON 아님 등. 생성은 살리고 교사에게
            print('[generate-mission] 검수 실패', repr(e), file=sys.stderr)
            reasons = ['검수를 못 했어요']
            break
        if not reasons:
            status = 'pass'
            break
        print(f'[generate-mission] 검수 {rounds}차 탈락', json.dumps(reasons, ensure_ascii=False), file=sys.stderr)
        if rounds > MAX_REGEN or left() < REGEN_NEEDS:
            break
        feedback = reasons
        step('regen', f'검수에서 걸린 점을 고쳐 다시 쓰는 중이에요 ({rounds}차 → {rounds + 1}차)')
    m['guard']['review'] = {'status': status, 'reasons': reasons, 'rounds': rounds}
    return m
