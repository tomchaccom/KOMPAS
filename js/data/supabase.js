/* Cut & Check — Supabase 클라이언트
 *
 * 인증과 DB를 담당한다. config.js처럼 설정 한 줄로 켜고 끈다.
 * Supabase가 설정 안 되어 있으면 localStorage 전용으로 동작한다.
 */
(function (CC) {
  'use strict';

  var given = (typeof window !== 'undefined' && window.CC_SUPABASE) || {};
  var url = given.url || '';
  var key = given.anonKey || '';

  /* Supabase CDN 클라이언트가 로드되어 있고 설정이 있을 때만 활성화 */
  var STUDENT_DOMAIN = 'students.invalid';
  var sb = null;

  /* PostgREST 는 한 번에 max_rows(1000)줄까지만 준다. 오래된 것부터 받으니 넘치면 '방금 마친 일'이 잘린다 —
     2026-10-21 마침 알림이 안 온 원인 후보. 1000줄씩 끝까지 받는다. make 는 매번 새 쿼리를 만든다(range 가 쿼리를 바꾼다) */
  var PAGE = 1000;
  function allPages(make, from) {
    from = from || 0;
    return make().range(from, from + PAGE - 1).then(function (r) {
      if (r.error) return { error: r.error };
      var d = r.data || [];
      if (d.length < PAGE) return { data: d };
      return allPages(make, from + PAGE).then(function (n) { return n.error ? n : { data: d.concat(n.data) }; });
    });
  }
  if (url && key && typeof window !== 'undefined' && window.supabase) {
    /* 발표 슬라이드(/slide2)는 같은 출처의 iframe 둘에 강사·학생을 따로 로그인한다. 같은 저장소라 세션 키를 나눈다 —
       window.name 은 그 iframe 안에서 페이지를 옮겨도 남는다. 이름 없는 일반 접속은 기본 키 그대로(기존 로그인 유지).
       다른 localStorage 키(발신함·prefs·recap)는 Supabase 모드에서 두 역할이 겹쳐 쓰지 않아 나누지 않았다. */
    var nm = String(window.name || '');
    sb = window.supabase.createClient(url, key, nm.indexOf('kompas-') === 0 ? { auth: { storageKey: 'sb-' + nm } } : undefined);
  }

  /* 서버 함수 부르기 — 지금 세션의 토큰을 붙인다. 생성·계정 함수는 로그인한 강사만 받는다.
   * 실패면 Error(서버가 준 문장) + err.status · err.body(응답 그대로 — 403 의 left 등), 422 면 err.reasons 에 걸린 이유. */
  function api(path, body, signal) {
    if (!sb) return Promise.reject(new Error('Supabase 미설정'));
    return sb.auth.getSession().then(function (res) {
      var token = res.data && res.data.session && res.data.session.access_token;
      if (!token) throw new Error('다시 로그인해 주세요.');
      return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
        signal: signal
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var err = new Error(j.error || '서버에 연결하지 못했어요.');
          err.status = r.status; err.body = j;
          if (r.status === 422) err.reasons = j.reasons;
          throw err;
        }
        return j;
      });
    });
  }

  function stream(path, body, onStep, signal) {
    if (!sb) return Promise.reject(new Error('Supabase 미설정'));
    return sb.auth.getSession().then(function (res) {
      var token = res.data && res.data.session && res.data.session.access_token;
      if (!token) throw new Error('다시 로그인해 주세요.');
      return CC.sse.post(path, { Authorization: 'Bearer ' + token }, body, onStep, signal);
    });
  }
  function accounts(body) { return api('/api/create-student', body); }

  CC.sb = {
    active: function () { return !!sb; },
    client: function () { return sb; },
    api: api,
    stream: stream,

    /* 수업에서 짚을 거리 — 성공 결과만 이 브라우저에 둔다. key 는 CC.recap 이 만든다 (새 튜터 대화가 쌓이면 바뀐다).
     * CC.sb.api 를 그때그때 찾는다 — 저장소가 막혀도 서버만 다시 부를 뿐이다 */
    recap: function (body, key) {
      try { var hit = localStorage.getItem(key); if (hit) return Promise.resolve(JSON.parse(hit)); } catch (e) { /* 막히면 서버로 */ }
      return CC.sb.api('/api/tutor-recap', body).then(function (j) {
        if (!(j && Array.isArray(j.items) && j.items.length)) return j;   /* 빈 결과·이상한 모양은 캐시하지 않는다 — 다시 누르면 다시 묻는다 */
        try { localStorage.setItem(key, JSON.stringify(j)); } catch (e) { /* 저장 못 해도 결과는 보인다 */ }
        return j;
      });
    },

    /* 공용 PC — 로그아웃할 때 학생 질문이 담긴 recap 캐시를 모두 지운다 */
    clearRecap: function () {
      try {
        var ks = [];
        for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('recap:') === 0) ks.push(k); }
        ks.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { /* 막혀 있으면 지울 것도 없다 */ }
    },

    /* ── 인증 ────────────────────────────────── */
    /* 프로필은 DB 트리거(handle_new_user)가 자동 생성한다.
     * 스스로 가입하는 사람은 모두 강사다 — 역할은 트리거가 정하고, 여기서 넘기지 않는다.
     * 학생 계정은 선생님이 createStudent 로 만든다. */
    signUp: function (email, password, name) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { name: name } }
      }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },

    /* 이메일이 아니면 학생 아이디다 — 내부 이메일은 <아이디>@students.invalid */
    loginEmail: function (idOrEmail) {
      var s = String(idOrEmail || '').trim();
      return s.indexOf('@') >= 0 ? s : s.toLowerCase() + '@' + STUDENT_DOMAIN;
    },

    signIn: function (idOrEmail, password) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.auth.signInWithPassword({ email: CC.sb.loginEmail(idOrEmail), password: password })
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data;
        });
    },

    signOut: function () {
      if (!sb) return Promise.resolve();
      return sb.auth.signOut();
    },

    getUser: function () {
      if (!sb) return Promise.resolve(null);
      return sb.auth.getUser().then(function (res) {
        return res.data.user || null;
      });
    },

    getProfile: function () {
      if (!sb) return Promise.resolve(null);
      return sb.auth.getUser().then(function (res) {
        if (!res.data.user) return null;
        return sb.from('profiles').select('*').eq('id', res.data.user.id).single()
          .then(function (pRes) { return pRes.data; });
      });
    },

    onAuthChange: function (cb) {
      if (!sb) return;
      sb.auth.onAuthStateChange(function (event, session) { cb(event, session); });
    },

    /* ── 교실 ────────────────────────────────── */
    createClassroom: function (name) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      var code = Math.random().toString(36).substring(2, 8).toUpperCase();
      return sb.auth.getUser().then(function (res) {
        return sb.from('classrooms').insert({
          code: code, name: name, teacher_id: res.data.user.id
        }).select().single().then(function (r) {
          if (r.error) throw r.error;
          return r.data;
        });
      });
    },

    myClassrooms: function () {
      if (!sb) return Promise.resolve([]);
      return sb.auth.getUser().then(function (res) {
        if (!res.data.user) return [];
        var uid = res.data.user.id;
        /* 강사: 자기 교실, 학생: 수강 중인 교실 */
        return sb.from('classrooms').select('*').eq('teacher_id', uid)
          .then(function (tRes) {
            if (tRes.data && tRes.data.length) return tRes.data;
            return sb.from('enrollments').select('classroom_id, onboard_due, onboard_set, classrooms(*)').eq('student_id', uid)
              .then(function (sRes) {
                /* onboard_due: 선생님이 레벨 테스트 대상으로 정한 시각 (없으면 null) */
                return (sRes.data || []).filter(function (e) { return e.classrooms; }).map(function (e) {
                  var r = {}; for (var k in e.classrooms) r[k] = e.classrooms[k];
                  r.onboard_due = e.onboard_due;
                  r.onboard_set = e.onboard_set;   /* 지정한 문제지 — 문제를 고르는 데만 쓰고 화면에 쓰지 않는다 */
                  return r;
                });
              });
          });
      });
    },

    /* ── 미션 ────────────────────────────────── */
    saveMission: function (classroomId, missionData) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.auth.getUser().then(function (res) {
        return sb.from('missions').insert({
          classroom_id: classroomId, data: missionData, created_by: res.data.user.id
        }).select().single().then(function (r) {
          if (r.error) throw r.error;
          return r.data;
        });
      });
    },

    getMissions: function (classroomId) {
      if (!sb) return Promise.resolve([]);
      return sb.from('missions').select('*').eq('classroom_id', classroomId)
        .order('created_at', { ascending: false })
        .then(function (r) { return r.data || []; });
    },

    updateMission: function (missionId, missionData) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.from('missions').update({ data: missionData })
        .eq('id', missionId).select().single()
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },

    deleteMission: function (missionId) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.from('missions').delete().eq('id', missionId)
        .then(function (r) { if (r.error) throw r.error; return r; });
    },

    /* ── 교실 학생 목록 ────────────────────────── */
    getClassroomStudents: function (classroomId) {
      if (!sb) return Promise.resolve([]);
      return sb.from('enrollments')
        .select('student_id, onboard_due, onboard_set, profiles(id, name, login_id)')
        .eq('classroom_id', classroomId)
        .then(function (r) {
          return (r.data || []).filter(function (e) { return e.profiles; }).map(function (e) {
            var p = {}; for (var k in e.profiles) p[k] = e.profiles[k];
            p.onboard_due = e.onboard_due;
            p.onboard_set = e.onboard_set;
            return p;
          });
        });
    },

    /* 레벨 테스트 대상 지정 · 풀기 — 시각은 서버가 찍는다 (assign_onboard2). set = 문제지 low/mid/high */
    assignOnboard: function (classroomId, studentId, assign, set) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.rpc('assign_onboard2', { cid: classroomId, sid: studentId, assign: !!assign, qset: set || 'mid' })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },

    /* 나침반 — 선생님: 서버(api/compass.py)에 list · analyze · send 를 부탁한다.
     * 학생: 선생님이 보낸 것만(바늘·방위·한마디) compass_mine 으로 받는다. 없으면 null */
    compass: function (action, body) {
      var o = { action: action };
      for (var k in (body || {})) o[k] = body[k];
      return CC.sb.api('/api/compass', o);
    },

    /* 누적 나침반 — 학생에게 보낸 바늘 하나. 0행이면 null (선생님이 아직 안 보냄) → { needle_deg, dir, length, sent_at } */
    compassMine: function () {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.rpc('compass_mine_v2')
        .then(function (r) { if (r.error) throw r.error; return (r.data && r.data[0]) || null; });
    },

    /* 미션별 선생님 한마디 — 보낸 것만. → { teacher_note, sent_at } | null */
    compassNote: function (missionDbId) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.rpc('compass_note', { mid: missionDbId })
        .then(function (r) { if (r.error) throw r.error; return (r.data && r.data[0]) || null; });
    },

    /* 선생님 알림 확인 — 내 교실의 확인한 키 전부 + 기능을 켠 시각(마이그레이션 적용 시각). RLS 가 내 행 · 내 교실만 준다 */
    alertChecks: function (classroomId) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return Promise.all([
        sb.rpc('alert_checks_since'),
        allPages(function () { return sb.from('alert_checks').select('alert_key').eq('classroom_id', classroomId).order('alert_key'); })
      ]).then(function (r) {
        if (r[0].error) throw r[0].error;
        if (r[1].error) throw r[1].error;
        return { since: new Date(r[0].data).getTime(), keys: r[1].data.map(function (x) { return x.alert_key; }) };
      });
    },

    /* 확인 — 다른 기기에서 같은 키를 또 눌러도 한 줄. teacher_id 는 DB 기본값 auth.uid() */
    checkAlert: function (classroomId, key) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.from('alert_checks').upsert({ classroom_id: classroomId, alert_key: key }, { onConflict: 'teacher_id,classroom_id,alert_key', ignoreDuplicates: true })
        .then(function (r) { if (r.error) throw r.error; });
    },

    /* 학생 계정 만들기 · 비밀번호 다시 만들기 — 서버(api/create-student.py)가 service 키로 한다.
     * 브라우저는 선생님 토큰만 넘긴다. password 를 비우면 서버가 만든다. → { loginId, password } */
    createStudent: function (classroomId, s) {
      return accounts({ action: 'create', classroomId: classroomId, name: s.name, loginId: s.loginId, password: s.password || '' });
    },

    resetStudentPassword: function (classroomId, loginId, password) {
      return accounts({ action: 'reset', classroomId: classroomId, loginId: loginId, password: password || '' });
    },

    /* 교실에서 학생 빼기 — 수강 한 줄만 지운다. 기록은 남는다.
     * RLS 에 막히면 에러 없이 0줄이 지워지므로, 지워진 줄이 없으면 실패로 본다 */
    removeStudent: function (classroomId, studentId) {
      if (!sb) return Promise.reject(new Error('Supabase 미설정'));
      return sb.from('enrollments').delete().eq('classroom_id', classroomId).eq('student_id', studentId).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!r.data || !r.data.length) throw new Error('학생을 뺄 수 없었어요. 권한을 확인해 주세요.');
          return r.data[0];
        });
    },

    /* ── 이벤트 (학생 기록) ──────────────────── */
    pushEvent: function (classroomId, missionId, event) {
      if (!sb) return Promise.resolve(null);
      return sb.auth.getUser().then(function (res) {
        if (!res.data.user) return null;
        return sb.from('student_events').insert({
          student_id: res.data.user.id,
          classroom_id: classroomId,
          mission_id: missionId,
          event: event
        }).then(function (r) {
          if (r.error) console.warn('이벤트 저장 실패:', r.error.message);
          return r;
        });
      });
    },

    getClassroomEvents: function (classroomId) {
      if (!sb) return Promise.resolve([]);
      return allPages(function () {
        return sb.from('student_events').select('*, profiles(name)')
          .eq('classroom_id', classroomId)
          .order('created_at', { ascending: true }).order('id', { ascending: true });
      }).then(function (r) { return r.error ? null : r.data; }); /* 실패는 null — 빈 목록과 구분한다 */
    },

    getMyEvents: function (classroomId, missionId) {
      if (!sb) return Promise.resolve([]);
      return sb.auth.getUser().then(function (res) {
        if (!res.data.user) return [];
        var make = function () {
          var q = sb.from('student_events').select('mission_id, event, created_at')
            .eq('student_id', res.data.user.id)
            .eq('classroom_id', classroomId)
            .order('created_at', { ascending: true }).order('id', { ascending: true });
          return missionId ? q.eq('mission_id', missionId) : q;
        };
        /* _missionDbId: 내 미션 목록이 미션별 상태를 셀 때 쓴다 (이벤트 본문에는 DB id 가 없다) */
        return allPages(make).then(function (r) {
          return (r.data || []).map(function (row) {
            var ev = {}; for (var k in row.event) ev[k] = row.event[k];
            ev._missionDbId = row.mission_id;
            ev._at = row.created_at;   /* 서버 시각 — 레벨 테스트 지정 시각과 견준다 */
            return ev;
          });
        });
      });
    }
  };
})(window.CC = window.CC || {});
