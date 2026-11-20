"""Cut & Check — 미션 생성 (유형 고르기 → 초안 → 검사 → 재요청 → 칸별 폴백)

  1. 유형 고르기 — 작은 스키마(_schema.CHOICE)로 14개 중 하나. 실패하면 키워드 규칙.
  2. 초안 — 그 유형의 스키마(_schema.DRAFTS[pid])만 넘긴다.
  3. 검사에 걸리면 칸별 사유를 붙여 다시 요청한다 (최대 MAX_RETRY 번, 시간이 남을 때만).
  4. 그래도 걸린 칸은 예전 고정 틀로 갈아 끼우고, 어느 칸인지 guard 에 남긴다.
     자료(data)는 갈아 끼울 틀이 없다 — 자료가 틀리면 미션 전체를 포기한다.
  5. 하드코딩·요행 함정은 코드가 붙인다. 하드코딩 함정은 엔진을 돌려야 나오는
     "첫 자료의 실제 결과"라 LLM 이 알 수 없다 (평가에서 12번 틀렸다).

LLM 호출은 call_llm(messages, schema, timeout) 로 주입받는다. 테스트는 가짜를 넣는다.
"""
import http.client
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

from pydantic import ValidationError

from _pipeline import run
from _progress import step
from _schema import CHOICE, DESC, DRAFTS, SPEC, counter_problems, failed_fields

DEFINE_Q = '어떤 결과가 나오면 성공일까요?'
DEADLINE = 55     # 초. Vercel maxDuration 60 안에서 응답까지 끝낸다
RETRY_NEEDS = 15  # 초. 이만큼 안 남았으면 재요청 대신 바로 기본 틀로 간다
MAX_RETRY = 2     # 자료는 기본 틀이 없어서, 시간이 남으면 한 번 더 기회를 준다
# 시간 계산 (gpt-5.4 실측 호출당 평균 9초·최대 13초, 2026-10-18). 호출마다 timeout 은 남은 시간이라 합이 55초를 못 넘는다.
#   유형 2 + 초안 13 + 재요청 13 + 재요청 13 = 41 → 검수(min(20, 남은 시간), 실측 3~5) 46 → 남은 9 < REGEN_NEEDS 25 라 재생성 안 함.
#   재요청 0번이면 2 + 13 + 검수 5 = 20 → 남은 35 ≥ 25 라 재생성 1번(유형 2 + 초안 13 + 검수 5 = 40) → 남은 15 < 25 에서 멈춤.
#   마지막 재요청은 남은 시간이 15초보다 많을 때만 시작한다. 그래서 호출 timeout·횟수는 그대로 둔다.

SYSTEM = '\n'.join([
    '당신은 중학교 1학년 수업에 쓸 데이터 정리 문제를 만든다.',
    '학생은 문제를 보고 성공 조건과 처리 방법을 스스로 정한 뒤, 자료 세 개로 실행해 보고 판단한다.',
    '세 자료는 한 이야기 속 서로 다른 사람·모둠·곳에서 온 자료다. 같은 자료에 요일만 바꿔 붙이지 않는다.',
    '앞 두 자료로는 대충 세운 기준도 통하게 만든다. 세 번째 자료는 반례다 — 셋째 출처가 낸 자료로, 앞 자료 항목과 새 항목을 섞고',
    '그 대충 세운 기준이 깨지게 쓴다. 코드가 실제로 돌려 보고 안 깨지면 코드가 다시 만든다.',
    '학생은 처음에 앞 두 자료만 본다. 그래서 상황·요청에 세 번째 자료의 출처(사람 이름, "세 사람" 같은 수)를 미리 쓰지 않는다.',
    '',
    '지키는 것',
    '- 답, 방법, 고칠 곳을 문제에 쓰지 않는다. 문제는 일부러 모호하게 쓴다.',
    '- 상황은 구체적인 생활 이야기로 쓰고(인물 이름이 나온다), 이야기 속에 푸는 방법은 쓰지 않는다.',
    '- 그 값이 왜 필요한지가 이야기에 있어야 한다. 상황 첫 문장은 누가 왜 곤란한지, 둘째 문장은 무엇을 정해야 하는지.',
    '  요청에는 구할 값과 그 값으로 할 일이 함께 드러난다. 답을 알면 할 일이 생겨야 한다. 문장 꼴은 하나로 맞추지 않는다.',
    '  여러 꼴의 예 (내용은 베끼지 않는다):',
    '    "모둠 회의를 잡으려는데 모두 되는 시간을 알려 주세요."',
    '    "체육복이 몇 벌 모자란지 봐서 주문서를 채워 주세요."',
    '    상황 "…회의 시간을 정해야 해요." → 요청 "둘 다 되는 시간을 찾아 주세요."',
    '  나쁜 예: "민지가 간식 이름이 몇 번 나왔는지 알아봐요." — 왜 알아야 하는지, 알아서 무엇을 하는지가 없다.',
    '  나쁜 예: "딕셔너리에서 명성 키를 찾아 값을 추출해 주세요" — 방법을 말한다.',
    '  예의 이야기를 그대로 쓰지 말고 오늘 수업에 맞는 새 이야기를 만든다.',
    '- 학생에게 보이는 문장은 존댓말, 한 칸에 한 문장(상황만 두 문장까지). 괄호·줄표·"예를 들어" 같은 덧붙임 없이 쓴다.',
    '- 칭찬하지 않는다. 한국어만 쓴다.',
    '- 성공 조건과 처리 방법은 코드가 붙인다. 당신은 쓰지 않는다.',
    '- 각 칸의 description 과 글자 수("N자 안")를 따른다.',
    '',
    'JSON 하나만 응답한다.',
])


# ── LLM 호출 ────────────────────────────────────────────────

API_URL = 'https://llm.pcl.kr/v1/chat/completions'
# 자체 서빙 pickle-general 은 2026-10-16 03시경부터 첫 토큰 전에 30초로 끊긴다. 같은 키의 유료 모델로 바꾸고,
# 서버를 고르는 일은 코드 수정 없이 Vercel 환경변수 LLM_MODEL 로 한다.
# 기본은 gpt-5.4 (2026-10-18 eval): mini 는 집합 수업을 공백 정리로 엉뚱하게 골랐고, claude-sonnet-5-5 는 15~28초에
# 게이트웨이가 켠 추론이 max_tokens 의 절반을 먹어 JSON 이 잘릴 위험이 있었다.
MODEL = os.environ.get('LLM_MODEL') or 'openai/gpt-5.4'


def _post(body, key, timeout):
    """게이트웨이가 가끔 504·502 를 낸다 (2026-10-16 eval 20회 중 2회, 9초쯤). 남은 시간 안에서 한 번만 다시 보낸다."""
    end = time.monotonic() + timeout
    for attempt in (1, 2):
        req = urllib.request.Request(API_URL, data=json.dumps(body).encode(), method='POST', headers={
            'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
        try:
            with urllib.request.urlopen(req, timeout=max(1, end - time.monotonic())) as r:
                return json.loads(r.read())['choices'][0]['message']['content']
        except urllib.error.HTTPError as e:
            if e.code not in (502, 503, 504) or attempt == 2 or end - time.monotonic() < 5:
                raise
        except (http.client.RemoteDisconnected, ConnectionResetError):
            if attempt == 2 or end - time.monotonic() < 5:
                raise


def _flat(s, defs=None):
    """게이트웨이 뒤 OpenAI 는 $defs·$ref 가 있거나 additionalProperties 가 빠진 객체가 있으면 400 을 낸다.
    pydantic 스키마는 둘 다 해당돼 초안이 매번 json_object 로 내려갔다 (2026-10-16 eval 23/23).
    maxLength 는 설명 글로 옮긴다 — 그대로 주면 그 길이에서 문장을 자른다 (situation 9/21, goals 8/25)."""
    defs = s.get('$defs', {}) if defs is None else defs
    if isinstance(s, dict):
        if '$ref' in s:
            rest = {k: v for k, v in s.items() if k != '$ref'}
            return _flat({**defs[s['$ref'].split('/')[-1]], **rest}, defs)
        o = {k: _flat(v, defs) for k, v in s.items() if k not in ('$defs', 'maxLength')}
        if 'maxLength' in s:  # 스키마로 주면 모델이 그 길이에서 말을 자른다 ('…실행하면 성'). 길이는 pydantic 이 검사한다
            o['description'] = (o.get('description', '') + f" ({s['maxLength']}자 안)").strip()
        if o.get('type') == 'object':
            o.setdefault('additionalProperties', False)
        return o
    if isinstance(s, list):
        return [_flat(v, defs) for v in s]
    return s


def pickle_llm(messages, schema, timeout, model=None):
    """structured output 을 쓴다. 서버가 거절하면 JSON 모드로 내려간다.

    평가에서 json_schema 는 매번 받아들여졌다. 어느 쪽이든 결과는 pydantic 이 똑같이 검사한다.
    """
    key = re.sub(r'\s', '', os.environ.get('PICKLE_API_KEY', ''))
    if not key:
        raise RuntimeError('PICKLE_API_KEY 가 설정되지 않았습니다.')
    body = {'model': model or MODEL, 'max_tokens': 1500, 'messages': messages}
    end = time.monotonic() + timeout
    try:
        return _post({**body, 'response_format': {
            'type': 'json_schema', 'json_schema': {'name': 'mission', 'schema': _flat(schema)}}}, key, timeout)
    except urllib.error.HTTPError as e:
        if e.code != 400:
            raise
    messages = [{**messages[0], 'content': messages[0]['content'] + '\n\n스키마:\n' +
                 json.dumps(schema, ensure_ascii=False)}] + messages[1:]
    # 400 까지 쓴 시간을 빼고 남은 만큼만 — 처음 timeout 을 다시 주면 DEADLINE 을 넘을 수 있다
    return _post({**body, 'messages': messages, 'response_format': {'type': 'json_object'}}, key, max(1, end - time.monotonic()))


def _json(raw):
    m = re.search(r'\{[\s\S]*\}', raw or '')
    try:
        data = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict) and isinstance(data.get('mission'), dict):  # 한 겹 감싸 보낸 경우
        data = data['mission']
    return data if isinstance(data, dict) else None


def _repair(pid, d):
    """항목 사이의 관계는 모델이 재요청해도 잘 못 맞췄다 (평가 3회차 실패 5건이 전부 자료).
    코드가 확실히 고칠 수 있는 것만 고치고, 고친 내용은 d['_repaired'] 에 남긴다.
    자료의 내용(무슨 단어인지)은 바꾸지 않는다 — 단위를 떼거나 이미 있는 단어를 옮길 뿐이다."""
    notes = d.setdefault('_repaired', [])
    data = d.get('data')
    if not isinstance(data, list) or len(data) < 2 or not all(isinstance(x, dict) for x in data[:2]):
        return
    for ds in data[:2]:
        if isinstance(ds.get('items'), list):  # 숫자를 숫자로 보낸 경우, 빈 항목
            ds['items'] = [str(x) for x in ds['items'] if str(x).strip()]
    if isinstance(d.get('filterTarget'), list):  # 엔진은 앞뒤 공백을 지우고 비교한다
        d['filterTarget'] = [str(x).strip() for x in d['filterTarget'] if str(x).strip()]
    ops = SPEC[pid]['ops']
    integer = lambda x: re.fullmatch(r'-?\d+', x.strip())  # noqa: E731
    if 'toNumber' in ops:
        for ds in data[:2]:
            for i, x in enumerate(ds.get('items', [])):
                m = None if integer(x) else re.fullmatch(r'\D{0,3}?(-?\d{1,3}(?:,\d{3})+|-?\d+)\s*\D{0,3}', x.strip())
                if m:  # "1,000원" → "1000"
                    ds['items'][i] = m.group(1).replace(',', '')
                    notes.append(f"'{x}' → '{ds['items'][i]}' (단위·쉼표를 뗐어요)")
        if 'filter' in ops:  # 숫자가 아닌 항목이 곧 걸러낼 대상이다
            # 모델이 숫자나 '숫자'·'문자' 같은 분류 이름을 넣어 오기도 했다 — 자료에 실제로 있는 글자 항목만 둔다
            have = {x.strip() for ds in data[:2] for x in ds.get('items', [])}
            ft = [x for x in (d.get('filterTarget') or []) if not integer(str(x)) and str(x).strip() in have]
            if ft != list(d.get('filterTarget') or []):
                notes.append('걸러낼 대상에서 자료에 없는 말과 숫자를 뺐어요')
            words = [x.strip() for ds in data[:2] for x in ds.get('items', []) if not integer(x) and x.strip() not in ft]
            if words:
                d['filterTarget'] = ft + list(dict.fromkeys(words))
                notes.append(f"걸러낼 대상에 {', '.join(dict.fromkeys(words))} 를 넣었어요")
    elif 'filter' in ops:
        # 자료 이름("민지 쪽지")을 걸러낼 대상에 넣어 오면, 아래에서 그게 자료 항목으로 끼어들었다 (2026-10-18)
        names = {str(ds.get('name', '')).strip() for ds in data[:2]}
        ft = [x for x in (d.get('filterTarget') or []) if x not in names]
        if ft != (d.get('filterTarget') or []):
            d['filterTarget'] = ft
            notes.append('걸러낼 대상에서 자료 이름을 뺐어요')
        items = [x for ds in data[:2] for x in ds.get('items', [])]
        if ft and not set(ft) & set(items):  # 걸러낼 대상이 자료에 없으면 걸러낼 게 없다
            for ds, w in zip(data[:2], (ft[0], ft[-1])):
                its = ds.setdefault('items', [])
                if len(its) >= 5:
                    its[-1] = w
                else:
                    its.append(w)
            notes.append(f"걸러낼 대상 {ft[0]}·{ft[-1]} 를 자료에 넣었어요")
    if 'groupCount' in ops and all(len(set(ds.get('items', []))) == len(ds.get('items', [])) for ds in data[:2]):
        its = data[0].setdefault('items', [])  # 겹치는 항목이 없으면 묶어 셀 게 없다
        if its:
            if len(its) >= 5:
                its[-1] = its[0]
            else:
                its.append(its[0])
            notes.append(f"'{its[0]}' 를 한 번 더 넣었어요 (겹치는 항목이 있어야 묶어 셀 수 있어요)")


def _ask_schema(pid):
    """반례 자료도 모델이 쓴다 — 이야기 속 셋째 출처의 자료여야 해서 코드가 첫 자료를 복사해 만들면
    "요일만 바뀐 같은 자료" 가 됐다 (2026-10-18 기준 12회 중 10회). 깨지는지는 _make_counter 가 돌려 본다."""
    s = DRAFTS[pid].model_json_schema()
    s['properties']['counter'] = {**s['properties']['counter'], 'description': (
        '세 번째이자 마지막 자료. 반례 — 같은 이야기 속 셋째 출처가 낸 자료로, 앞 두 자료로 세운 기준이 여기서 깨진다.')}
    return s


def _make_counter(pid, d):
    """모델이 쓴 반례를 정답으로 실제로 돌려 본다. 깨지면 그대로 쓰고, 안 깨지면 코드 후보 중 깨지는 첫 것으로 바꾼다.
    이름은 모델이 지은 것을 둔다. 자료가 아직 틀려서 돌릴 수 없으면 그대로 두고 검사에 맡긴다."""
    c = d.get('counter') if isinstance(d.get('counter'), dict) else {}
    data, ft = d.get('data'), d.get('filterTarget') or []
    try:
        items1, items2 = [str(x) for x in data[0]['items']], [str(x) for x in data[1]['items']]
        rows = [{'items': items1}, {'items': items2}]
        own = isinstance(c.get('text'), str) and c.get('axis') in AXES
        if own and not counter_problems(pid, rows, ft, c):
            return
        pick = next((x for x in _counter_candidates(pid, items1, items2, ft)
                     if not counter_problems(pid, rows, ft, x)), None)
    except Exception:  # noqa: BLE001 — 자료 칸이 깨진 초안. 그 사유는 pydantic 이 따로 낸다
        return
    if pick:
        name = str(c.get('name') or '')
        if not name.strip() or re.search(r'반례|예시|함정|보조', name):  # 이름이 함정을 알려 버린다
            name = pick['name']
        d['counter'] = {**pick, 'name': name}
        if own:  # 교사 화면 '자동으로 손봤어요' — 반례 내용을 코드가 바꿨다는 사실은 숨기지 않는다
            d.setdefault('_repaired', []).append('세 번째 자료가 기준을 깨지 못해서 코드가 다시 만들었어요')


def _retype(pid, m, bad):
    """'글자 빼고 숫자 더하기' 를 골랐는데 자료가 전부 숫자면 뺄 글자가 없어 실패했다 (2026-10-17 배포 확인,
    '숫자 더하기 / int로 바꿔서 합계'). 같은 자료로 '숫자 더하기' 유형으로 바꾼다 — 자료 내용은 그대로다."""
    if pid != 'split-filter-num-sum' or not isinstance(m, dict):
        return pid, m, bad
    try:
        items = [str(x).strip() for d in m['data'][:2] for x in d['items']]
    except (KeyError, TypeError, IndexError):
        return pid, m, bad
    if not items or not all(re.fullmatch(r'-?\d+', x) for x in items):
        return pid, m, bad
    notes = m.pop('_repaired', [])
    m = {k: v for k, v in m.items() if k not in ('filterTarget', 'filterDesc')}
    m2, bad2 = _parse('split-num-sum', m)
    m2['_repaired'] = notes + ["자료가 모두 숫자라 '숫자 더하기' 유형으로 바꿨어요"] + m2.get('_repaired', [])
    return 'split-num-sum', m2, bad2


def _parse(pid, raw):
    """→ (초안 dict | None, {칸: [사유]})"""
    data = raw if isinstance(raw, dict) else _json(raw)
    if data is None:
        return None, {'json': ['JSON 이 아님']}
    data.pop('pipelineId', None)
    _repair(pid, data)
    _make_counter(pid, data)
    try:
        DRAFTS[pid].model_validate(data)
        return data, {}
    except ValidationError as e:
        return data, failed_fields(e)


# ── 1. 유형 고르기 ──────────────────────────────────────────

# 예전 Node 생성기가 유형을 정하던 키워드 규칙. 이제는 LLM 이 못 골랐을 때만 쓴다.
KEYWORDS = [  # 구체적인 것이 먼저 걸리게 위에 둔다
    (['예외', 'try', 'except', '에러', 'error'], 'split-filter-num-sum'),
    (['최대', 'max', '가장 큰'], 'split-num-max'),
    (['최소', 'min', '가장 작은'], 'split-num-min'),
    (['딕셔너리', 'dict', '사전', '분류', '빈도'], 'split-group'),
    (['정렬', 'sort', '순서', '나열'], 'split-sort-join'),
    (['함수', 'def ', '변환', 'strip', 'replace', 'upper', 'lower', '공백'], 'split-transform-join'),
    (['조건', 'if', '필터', '걸러', '선별', '골라', '반복', 'for', 'while'], 'split-filter-count'),
    (['교집합', '공통', '둘 다', '모두 되는'], 'split-filter-join'),
    (['집합', 'set', '중복'], 'split-unique-count'),
    (['숫자', 'int', 'sum', '합계', '형변환', '계산', '더하'], 'split-num-sum'),
]


def by_keyword(lesson, key_point):
    text = f'{lesson} {key_point}'.lower()
    return next((pid for words, pid in KEYWORDS if any(w in text for w in words)), 'split-unique-count')


# 집합 수업은 겹친 것 세기로만 가고 '두 사람 모두' 로는 한 번도 안 왔다 (2026-10-18 eval 2/2).
# 규칙이 아니라 힌트다 — 모델이 수업을 보고 다른 유형을 고를 수 있다.
INTERSECT = re.compile(r'집합|교집합|공통|겹치는|둘 다|모두 되는')
INTERSECT_TYPES = ('split-filter-join', 'split-filter-count', 'split-filter-sort-join', 'split-filter-unique-count')
INTERSECT_HINT = ('힌트: 이 수업은 "두 사람 모두에게 있는 것 찾기"(모두 되는 시간, 둘 다 먹는 간식)와 잘 이어진다. '
                  '그 문제는 split-filter-join 이다 — 고정 목록이 한 사람의 자료다. 수업에 더 맞는 유형이 있으면 그걸 고른다.')
STORY_INTERSECT = ('이 문제는 "두 사람 모두에게 있는 것 찾기" 이야기로 만들면 좋다: 고정 목록 = 한 사람의 자료(학생에게 보인다), '
                   '앞 두 자료 = 그와 맞춰 볼 다른 사람들이 낸 자료, 셋째 자료 = 같은 이야기의 또 다른 사람.')


def choose(lesson, key_point, call_llm, timeout):
    hint = ('\n\n' + INTERSECT_HINT) if INTERSECT.search(f'{lesson} {key_point}') else ''
    messages = [
        {'role': 'system', 'content': '중학교 1학년 데이터 정리 문제의 유형을 고른다. JSON 하나만 응답한다.'},
        {'role': 'user', 'content': f'오늘 수업: {lesson}\n핵심: {key_point}\n\n이 수업과 가장 잘 이어지는 유형:\n' +
         '\n'.join(f'- {k}: {v}' for k, v in DESC.items()) + hint},
    ]
    try:
        pid = (_json(call_llm(messages, CHOICE.model_json_schema(), timeout)) or {}).get('pipelineId')
    except Exception as e:  # 유형 고르기가 실패해도 키워드로 이어 간다
        print('[generate-mission] 유형 고르기 실패', repr(e), file=sys.stderr)
        pid = None
    return (pid, 'llm') if pid in SPEC else (by_keyword(lesson, key_point), 'keyword')


# ── 폴백 (예전 고정 틀) ─────────────────────────────────────

def _josa(word, pair):
    """pair = '이가' | '은는' | '을를'. 받침이 없거나 한글·숫자가 아니면 뒤쪽."""
    c = str(word)[-1:] or ' '
    has = '가' <= c <= '힣' and (ord(c) - 0xAC00) % 28 != 0
    return pair[0] if has or c in '013678' else pair[1]  # 영·일·삼·육·칠·팔


CORRECT = {  # 정답 보기 — 결과로만, 모두 '~가 나오면 성공' 한 틀로 (2026-10-17 사람 결정: 보기 구성이 헷갈렸다)
    'count': '{item}{iga} 모두 몇 개인지 나오면 성공', 'total': '겹친 것까지 전부 센 {item} 수가 나오면 성공',
    'unique': '겹치는 {item}{eunneun} 한 번만 센 수가 나오면 성공', 'filtered_count': '조건에 맞는 {item}만 센 수가 나오면 성공',
    'filtered': '조건에 맞는 {item}만 남은 목록이 나오면 성공', 'sorted': '{item}{iga} 순서대로 놓인 목록이 나오면 성공',
    'transformed': '{item}마다 깔끔하게 다듬은 목록이 나오면 성공', 'sum': '{item}{eulreul} 모두 더한 값이 나오면 성공',
    'filtered_sum': '숫자인 {item}만 더한 값이 나오면 성공', 'max': '가장 큰 {item}{iga} 나오면 성공',
    'min': '가장 작은 {item}{iga} 나오면 성공', 'group': '{item}마다 몇 번 나왔는지가 나오면 성공',
}

BRIEF_FALLBACK = {  # 요청 기본 틀 — 구할 값만 말하고 방법은 말하지 않는다
    'count': '{item}{iga} 모두 몇 개인지 알려 주세요.', 'total': '{item}{iga} 모두 몇 개인지 알려 주세요.',
    'unique': '{item}{iga} 모두 몇 가지인지 알려 주세요.', 'filtered_count': '조건에 맞는 {item}{iga} 몇 개인지 알려 주세요.',
    'filtered': '조건에 맞는 {item}만 남긴 목록을 만들어 주세요.', 'sorted': '{item}{eunneun} 순서대로 놓은 목록을 만들어 주세요.',
    'transformed': '{item} 목록을 깔끔하게 다시 만들어 주세요.', 'sum': '{item}{eulreul} 모두 더하면 얼마인지 알려 주세요.',
    'filtered_sum': '{item} 중 숫자를 모두 더하면 얼마인지 알려 주세요.', 'max': '가장 큰 {item}{iga} 얼마인지 알려 주세요.',
    'min': '가장 작은 {item}{iga} 얼마인지 알려 주세요.', 'group': '{item}마다 몇 번 나왔는지 알려 주세요.',
}


AXES = ('count', 'sep', 'empty', 'invisible', 'boundary')


def _counter_candidates(pid, items1, items2, ft):
    """모델 반례가 안 깨질 때만 쓴다. 첫 자료로 그대로 시작하는 후보는 counter_problems 가 거른다 —
    두 자료 항목을 섞고 순서·개수를 바꿔 '셋째 출처' 처럼 보이게 만든다."""
    ops = SPEC[pid]['ops']
    other = '다른 곳에서 온 자료'
    mix = [x for pair in zip(items2, items1) for x in pair] + items2[len(items1):] + items1[len(items2):]
    if 'filter' in ops:  # 걸러낼 대상이 하나도 없는 자료 → 결과가 비어 버린다
        safe = list(dict.fromkeys(x for x in mix if x not in ft))
        rest = ft + ft[:1] if 'toNumber' in ops else (safe + ['사과', '바나나', '포도'])[:4]
        yield {'name': other, 'text': ','.join(rest), 'axis': 'empty'}
    if 'transform' in ops:  # 눈에 안 보이는 앞뒤 공백
        yield {'name': other, 'text': ','.join(' ' + x.strip() + ' ' for x in reversed(items2)), 'axis': 'invisible'}
    new = [x for x in items2 if x not in items1][:1]  # 둘째 자료에만 있는 항목 — 서로 다른 개수가 바뀐다
    for n in range(len(items1) + 2, 1, -1):  # 개수를 바꿔 가며
        yield {'name': other, 'text': ','.join(mix[:n]), 'axis': 'count'}
    for extra in ([items1[0], items2[0]], items2[:2], items2[:1], new):
        yield {'name': other, 'text': ','.join(items2 + extra), 'axis': 'count'}
        yield {'name': other, 'text': ','.join(list(reversed(items1)) + extra), 'axis': 'count'}
    if 'toNumber' in ops and 'filter' not in ops:  # 최댓값·최솟값은 끝값이 바뀌어야 깨진다
        nums = [int(x) for x in items1]
        for v in (max(nums) + 100, min(nums) - 1):
            yield {'name': other, 'text': ','.join(items2[:2] + [str(v)] + items1[:1]), 'axis': 'count'}


def _fallback(field, pid, m):
    item = m.get('itemName') or '항목'
    items1, items2 = m['data'][0]['items'], m['data'][1]['items']
    ft = m.get('filterTarget') or []
    if field == 'title':
        return '오늘의 미션'
    if field == 'brief':
        key = next(iter(SPEC[pid]['keys']))
        return BRIEF_FALLBACK[key].format(item=item, iga=_josa(item, '이가'), eunneun=_josa(item, '은는'),
                                          eulreul=_josa(item, '을를'))
    if field == 'situation':
        return ''
    if field == 'itemName':
        return '항목'
    if field == 'filterDesc':
        return '정해 둔 목록'  # '골라낼' 은 방법 낱말이라 이름 검사에 걸린다
    if field == 'counter':
        for c in _counter_candidates(pid, items1, items2, ft):
            if not counter_problems(pid, m['data'], ft, c):
                return c
        return None
    return None  # data · filterTarget · json — 갈아 끼울 틀이 없다


ORDER = ['itemName', 'filterDesc', 'title', 'brief', 'situation', 'counter']


# ── 함정 보기 (코드가 쓴다) ─────────────────────────────────

def _hardcode(value, name):
    """첫 자료의 실제 결과를 그대로 성공으로 삼는 문장. 어느 자료의 답인지 밝힌다 —
    출처가 없으면 숫자가 갑자기 튀어나온 것처럼 보였다 (2026-10-17)."""
    if isinstance(value, dict):
        k, n = next(iter(value.items()), ('', 0))
        return f'{name}처럼 {k}{_josa(k, "이가")} {n}번 나오면 성공'
    if value in (None, ''):
        return f'{name}처럼 빈 결과가 나오면 성공'
    if isinstance(value, str) and len(value) > 12:
        first = re.split(r'[,\s→]+', value)[0]
        return f'{name}처럼 {first}{_josa(first, "이가")} 맨 앞이면 성공'
    return f'{name}의 답과 같은 {value}{_josa(value, "이가")} 나오면 성공'


def _options(pid, m):
    ft = m.get('filterTarget')
    first_key, slots = next(iter(SPEC[pid]['keys'].items()))
    value = run(pid, slots, {'filterTarget': ft} if ft else {}, ','.join(m['data'][0]['items']))['value']
    opts = [{'v': _hardcode(value, m['data'][0]['name']), 'trap': 'hardcode'}]
    item = m.get('itemName') or '항목'
    # 진짜 보기는 요청이 묻는 것 하나 — 요청이 이제 구할 값을 밝히므로 '다른 해석' 보기는 헷갈리기만 했다
    opts.append({'v': CORRECT[first_key].format(item=item, iga=_josa(item, '이가'), eunneun=_josa(item, '은는'),
                                                eulreul=_josa(item, '을를')), 'trap': None, 'key': first_key})
    opts.append({'v': '에러 없이 끝나기만 하면 성공', 'trap': 'luck'})
    random.shuffle(opts)  # 늘 같은 자리에 있으면 학생은 내용이 아니라 자리를 외운다
    return opts


# ── 조립 ────────────────────────────────────────────────────

def _assemble(pid, m, lesson, key_point, guard):
    mission = {
        'id': 'ai-' + format(int(time.time() * 1000), 'x'), 'no': 'AI', 'type': 'sentence',
        'pipelineId': pid, 'stage': m['title'], 'title': m['title'],
        'brief': m['brief'], 'situation': m.get('situation', ''),
        'lesson': lesson, 'keyPoint': key_point,
        'define': {'q': DEFINE_Q, 'options': _options(pid, m)},
        'inputs': [{'id': f'd0{i + 1}', 'name': d['name'], 'v': ','.join(d['items'])} for i, d in enumerate(m['data'])]
        + [{'id': 'd03', 'name': m['counter']['name'], 'v': m['counter']['text'],
            'counter': True, 'axis': m['counter']['axis']}],
        'guard': guard,
    }
    if m.get('filterTarget'):
        mission['pipelineParams'] = {'filterTarget': m['filterTarget']}
        mission['filterDesc'] = m.get('filterDesc', '')
    return mission


class GenerateError(Exception):
    def __init__(self, msg, reasons):
        super().__init__(msg)
        self.reasons = reasons


DIFFICULTY = {'easy': '쉽게', 'medium': '보통으로', 'hard': '어렵게'}


def level_of(body):
    """요청 body 의 난이도·분포. 힌트일 뿐 — 모양이 틀리면 400 이 아니라 버리고 진행한다."""
    d, st = body.get('difficulty'), body.get('stages')
    d = d if d in ('easy', 'medium', 'hard') else None
    st = {k: v for k, v in st.items() if type(v) is int and v >= 0} if isinstance(st, dict) else {}
    return {'difficulty': d, 'stages': st} if d or st else None


def level_note(level):
    """교사가 본 반의 진단 분포를 ask 에 붙이는 문장. 없으면 ''."""
    if not level:
        return ''
    st = level.get('stages') or {}
    n = {k: st.get(k, 0) for k in ('base', 'combine', 'ready')}
    out = []
    if level.get('difficulty') in DIFFICULTY:
        out.append(f"난이도는 {DIFFICULTY[level['difficulty']]} 맞추세요.")
    top = max(n, key=n.get)  # 같으면 앞쪽(기초 쪽)을 따른다
    if n[top]:
        out.append({'base': '이 반은 기초가 가장 많으니 한 가지 개념만 쓰는 문제로 만드세요.',
                    'combine': '이 반은 조합 전 학생이 가장 많으니 두 개념을 엮는 문제까지 가도 됩니다.',
                    'ready': '이 반은 조합이 가능한 학생이 가장 많으니 여러 개념을 엮어도 됩니다.'}[top])
    if sum(n.values()) and st.get('hardcode', 0) * 2 >= sum(n.values()):
        out.append('이 반은 결과만 맞추는 풀이가 많으니 반례는 항목 개수를 바꾸는 것으로 만드세요.')
    return ('\n\n' + ' '.join(out)) if out else ''


def generate(lesson, key_point, call_llm=pickle_llm, feedback=None, t0=None, level=None):
    t0 = t0 or time.monotonic()  # make_mission 이 주면 요청 전체 시간을 같이 쓴다
    left = lambda: DEADLINE - (time.monotonic() - t0)  # noqa: E731

    if not feedback:  # 다시 만들 때는 _review 가 이미 '다시 쓰는 중' 을 알렸다
        step('choose', '수업에 맞는 문제 유형을 고르는 중이에요')
    pid, picked = choose(lesson, key_point, call_llm, min(15, left()))
    schema = _ask_schema(pid)
    ask = f'오늘 수업: {lesson}\n핵심: {key_point}\n유형: {DESC[pid]}\n\n이 수업과 이어지는 문제 하나를 만드세요.' + level_note(level)
    if pid in INTERSECT_TYPES and INTERSECT.search(f'{lesson} {key_point}'):
        ask += '\n\n' + STORY_INTERSECT
    if feedback:  # 검수에서 걸린 이유 — 처음부터 다시 만들 때만 온다
        ask += '\n\n지난번 문제는 검수에서 이렇게 걸렸습니다. 이번엔 피하세요:\n' + '\n'.join('- ' + f for f in feedback)
    messages = [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': ask}]
    if not feedback:
        step('draft', '문제 초안을 쓰는 중이에요')
    raw = call_llm(messages, schema, left())
    m, bad = _parse(pid, raw)
    pid, m, bad = _retype(pid, m, bad)
    schema = _ask_schema(pid)
    retried = 0
    while bad and retried < MAX_RETRY and left() > RETRY_NEEDS:
        retried += 1
        step('fix', f'규칙에 어긋난 칸을 고치는 중이에요 ({retried}차)')
        # 어떤 규칙이 얼마나 자주 걸리는지가 프롬프트 개선의 유일한 근거다 (docs/llm.md 2절)
        print(f'[generate-mission] {retried}차 사유', json.dumps(bad, ensure_ascii=False), file=sys.stderr)
        messages += [
            {'role': 'assistant', 'content': raw},
            {'role': 'user', 'content': '아래 칸이 규칙에 어긋납니다. 고친 JSON 전체를 다시 보내세요.\n' +
             json.dumps(bad, ensure_ascii=False, indent=1)},
        ]
        try:
            raw = call_llm(messages, schema, left())
        except Exception as e:  # 재요청이 시간 초과·오류면 이미 받은 초안으로 마무리한다
            print('[generate-mission] 재요청 실패', repr(e), file=sys.stderr)
            break
        m2, bad2 = _parse(pid, raw)
        if m2 is not None:
            m, bad = m2, bad2
            pid, m, bad = _retype(pid, m, bad)
            schema = _ask_schema(pid)

    reasons = {f: v for f, v in bad.items()}  # 남은 사유 — 교사 화면에 '왜 기본 틀인지' 로 간다
    if m is None or any(f not in ORDER for f in bad):
        raise GenerateError('문제를 만들지 못했어요. 다시 생성해 주세요.', {**reasons, 'pipelineId': [pid]})

    # 칸이 아예 빠져 있으면 pydantic 이 내용 검사를 건너뛰어서, 빠진 칸을 채운 뒤에야
    # 다른 칸(예: 반말 brief)이 드러난다. 그래서 드러난 칸이 없어질 때까지 갈아 끼운다.
    swapped, todo = [], dict(bad)
    while todo:
        if any(f not in ORDER or f in swapped for f in todo):
            # 폴백까지 걸리면 틀 자체가 틀린 것 — 내보내지 않는다
            raise GenerateError('문제를 만들지 못했어요. 다시 생성해 주세요.', {**reasons, 'fallback': todo})
        for field in ORDER:
            if field in todo:
                m[field] = _fallback(field, pid, m)
                swapped.append(field)
        m, todo = _parse(pid, m)
        for f, v in todo.items():
            reasons.setdefault(f, v)

    repaired = list(dict.fromkeys(m.pop('_repaired', [])))
    return _assemble(pid, m, lesson, key_point, {'fallback': swapped, 'reasons': reasons, 'retried': retried,
                                                 'picked': picked, 'repaired': repaired})
