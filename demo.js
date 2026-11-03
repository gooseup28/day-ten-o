/*
 * DAY-TEN-O 포트폴리오 데모 전용 데이터 계층
 * - 원본 앱의 Supabase 클라이언트와 같은 모양(from().select().eq()...)으로 동작하는 가짜 DB
 * - 모든 데이터는 방문자 브라우저의 localStorage에만 저장되고 외부로 전송되지 않음
 * - 처음 열면 오늘 날짜 기준 샘플 데이터를 채움
 */
(function () {
    const DB_KEY = 'dayteno_demo_db';
    const ENLIST_KEY = 'dayteno_enlist_date';
    const STORAGE_PREFIXES = ['dayteno_', 'day_ten_o'];

    /* ================= [DEMO: DATE HELPERS] ================= */
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const addMonths = (d, n) => {
        const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
        x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
        return x;
    };
    const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
    const datesBetween = (start, end) => {
        const out = [];
        for (let d = parse(start); d <= parse(end); d = addDays(d, 1)) out.push(fmt(d));
        return out;
    };

    // 언제 열어도 '복무 중반'으로 보이도록 입대일은 오늘로부터 10개월 전
    const defaultEnlistDate = () => fmt(addMonths(today(), -10));

    /* ================= [DEMO: STORAGE] ================= */
    let memory = null; // localStorage를 쓸 수 없는 환경(사생활 보호 모드 등)용 대체 저장소

    function writeDB(db) {
        memory = db;
        try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {}
    }

    function readDB() {
        try {
            const raw = localStorage.getItem(DB_KEY);
            if (raw) return (memory = JSON.parse(raw));
        } catch (e) {}
        if (!memory) writeDB(buildSeed());
        return memory;
    }

    function reset() {
        try {
            Object.keys(localStorage)
                .filter(k => STORAGE_PREFIXES.some(p => k.startsWith(p)))
                .forEach(k => localStorage.removeItem(k));
        } catch (e) {}
        memory = null;
        location.reload();
    }

    /* ================= [DEMO: QUERY BUILDER] ================= */
    const clone = v => JSON.parse(JSON.stringify(v));
    const same = (a, b) => a === b || (a != null && b != null && String(a) === String(b));

    // SQL LIKE 패턴(%, _)을 정규식으로 변환
    function likeToRegex(pattern) {
        const src = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(`^${src}$`, 's');
    }

    // 'room_id.eq.default' / 'room_id.is.null' 형태의 or() 조건 해석
    function parseCondition(expr) {
        const [col, op, ...rest] = expr.split('.');
        const value = rest.join('.');
        if (op === 'is' && value === 'null') return r => r[col] == null;
        if (op === 'eq') return r => same(r[col], value);
        return () => false;
    }

    class Query {
        constructor(table) {
            this.table = table;
            this.action = 'select';
            this.filters = [];
            this.payload = null;
            this.returning = false;
            this.sortKey = null;
            this.ascending = true;
            this.max = null;
        }

        select() { if (this.action !== 'select') this.returning = true; return this; }
        insert(rows) { this.action = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
        update(values) { this.action = 'update'; this.payload = values; return this; }
        delete() { this.action = 'delete'; return this; }

        eq(col, val) { this.filters.push(r => same(r[col], val)); return this; }
        not(col, op, val) { if (op === 'eq') this.filters.push(r => !same(r[col], val)); return this; }
        in(col, vals) { const set = new Set(vals.map(String)); this.filters.push(r => set.has(String(r[col]))); return this; }
        like(col, pattern) { const re = likeToRegex(pattern); this.filters.push(r => typeof r[col] === 'string' && re.test(r[col])); return this; }
        or(expr) { const conds = expr.split(',').map(parseCondition); this.filters.push(r => conds.some(c => c(r))); return this; }
        order(col, opts = {}) { this.sortKey = col; this.ascending = opts.ascending !== false; return this; }
        limit(n) { this.max = n; return this; }

        // await 시점에 실행 (Supabase 빌더처럼 thenable)
        then(onFulfilled, onRejected) {
            return new Promise(resolve => resolve(this.run())).then(onFulfilled, onRejected);
        }

        run() {
            const db = readDB();
            const rows = db.tables[this.table] || (db.tables[this.table] = []);
            const match = r => this.filters.every(f => f(r));
            let data;

            if (this.action === 'insert') {
                data = this.payload.map(p => ({ is_completed: false, room_id: null, ...p, id: ++db.lastId }));
                rows.push(...data);
                writeDB(db);
            } else if (this.action === 'update') {
                data = rows.filter(match);
                data.forEach(r => Object.assign(r, this.payload));
                writeDB(db);
            } else if (this.action === 'delete') {
                data = rows.filter(match);
                db.tables[this.table] = rows.filter(r => !match(r));
                writeDB(db);
            } else {
                data = rows.filter(match);
                if (this.sortKey) {
                    const k = this.sortKey, dir = this.ascending ? 1 : -1;
                    data.sort((a, b) => (typeof a[k] === 'number' ? a[k] - b[k] : String(a[k]).localeCompare(String(b[k]))) * dir);
                }
                if (this.max != null) data = data.slice(0, this.max);
                return { data: clone(data), error: null };
            }
            return { data: this.returning ? clone(data) : null, error: null };
        }
    }

    function createClient() {
        readDB(); // 앱 초기화 전에 샘플 데이터와 입대일을 준비
        return {
            from: table => new Query(table),
            // 데모는 서버가 없으므로 실시간 동기화 채널은 아무 일도 하지 않음
            channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; }
        };
    }

    /* ================= [DEMO: SAMPLE DATA] ================= */
    function buildSeed() {
        const t = today();
        const enlist = addMonths(t, -10);
        const y = t.getFullYear(), m = t.getMonth();
        const lastDay = new Date(y, m + 1, 0).getDate();
        const thisMonth = n => fmt(new Date(y, m, Math.min(n, lastDay)));
        const monthsAgo = (k, n) => fmt(new Date(y, m - k, n));
        const fromToday = n => fmt(addDays(t, n));

        const rows = [];
        let lastId = 0;
        let eventSeq = Date.now();
        let grantSeq = eventSeq - 1000000;
        const add = (date, task, isCompleted = false) => rows.push({ id: ++lastId, date, task: JSON.stringify(task), is_completed: isCompleted, room_id: 'default' });

        // 휴가 취득 내역
        const history = [];
        const grant = (type, reason, days, date) => { const g = { id: ++grantSeq, type, reason, days, date }; history.push(g); return g; };
        const annual = grant('연가', '정기 연가', 24, fmt(enlist));
        const shooting = grant('포상', '사격 우수자', 2, fmt(addMonths(enlist, 2)));
        grant('포상', '체력검정 특급', 1, fmt(addMonths(enlist, 4)));
        grant('위로', '전술훈련 위로', 2, fmt(addMonths(enlist, 6)));
        const model = grant('포상', '모범 병사 표창', 2, fromToday(-20));

        const usage = { annual: 0, reward: 0, comfort: 0 };
        const leaveKey = { '연가': 'annual', '포상': 'reward', '위로': 'comfort' };

        // 원본 앱과 같은 방식: 여러 날 일정은 날짜마다 같은 내용을 한 줄씩 저장
        const event = (start, end, o) => {
            const days = datesBetween(start, end);
            const isLeave = !!leaveKey[o.leaveType];
            if (isLeave) usage[leaveKey[o.leaveType]] += days.length;
            const payload = {
                is_json_event: true, type: o.type, color: o.color, title: o.title,
                startDate: start, endDate: end, startTime: o.startTime || '', endTime: o.endTime || '', memo: o.memo || '',
                eventId: ++eventSeq, useDays: isLeave ? days.length : 0, leaveType: o.leaveType,
                usedHolidayId: o.grant ? o.grant.id : null, calendar_type: o.calendar || 'basic'
            };
            days.forEach(d => add(d, payload));
        };

        const custom = [{ name: '면회', color: 'var(--accent-pink)' }];
        add('custom_categories', custom);

        // 지난 휴가
        event(monthsAgo(4, 10), monthsAgo(4, 13), { type: '연가', leaveType: '연가', color: 'var(--event-vacation)', title: annual.reason, grant: annual, memo: '첫 정기휴가. 집밥 실컷 먹기' });
        event(monthsAgo(3, 18), monthsAgo(3, 19), { type: '포상', leaveType: '포상', color: 'var(--event-reward)', title: shooting.reason, grant: shooting });

        // 이번 달 휴가 캘린더
        event(thisMonth(6), thisMonth(6), { type: '외출 (정기외출)', leaveType: '외출', color: 'var(--event-out)', title: '부모님과 점심', memo: '부대 앞 식당 12시' });
        event(thisMonth(10), thisMonth(12), { type: '연가', leaveType: '연가', color: 'var(--event-vacation)', title: annual.reason, grant: annual, memo: '친구 결혼식 참석' });
        event(thisMonth(15), thisMonth(15), { type: '외출 (평일외출)', leaveType: '외출', color: 'var(--event-out)', title: '치과 진료' });
        event(thisMonth(20), thisMonth(21), { type: '외박', leaveType: '외박', color: 'var(--event-sleep)', title: '동기들과 외박' });
        event(thisMonth(24), thisMonth(25), { type: '포상', leaveType: '포상', color: 'var(--event-reward)', title: model.reason, grant: model });
        event(thisMonth(28), thisMonth(28), { type: '면회', leaveType: '면회', color: 'var(--accent-pink)', title: '친구 면회' });

        // 이번 달 근무 캘린더
        const duty = (day, type, leaveType, color, title, startTime, endTime) =>
            event(thisMonth(day), thisMonth(day), { type, leaveType, color, title, startTime, endTime, calendar: 'duty' });
        [2, 9, 16, 23].forEach(d => duty(d, '당직', '당직', '#FF9F0A', '중대 당직', '18:00', '08:00'));
        [4, 18].forEach(d => duty(d, 'CCTV (행정반)', 'CCTV', '#32ADE6', 'CCTV 감시', '09:00', '12:00'));
        [11, 26].forEach(d => duty(d, 'CCTV (지통실)', 'CCTV', '#32ADE6', 'CCTV 감시', '14:00', '17:00'));
        [7, 21].forEach(d => duty(d, '위병소', '위병소', '#BF5AF2', '위병소 근무', '06:00', '08:00'));

        // 할 일
        add(fromToday(0), { content: '세탁물 걷기', calendar_type: 'basic' }, true);
        add(fromToday(0), { content: '부모님께 전화드리기', calendar_type: 'basic' });
        add(fromToday(1), { content: '체력단련 3km 달리기', calendar_type: 'basic' });

        // 메모 (오래된 것부터 넣어야 '최신순' 정렬이 자연스러움)
        add('memo_' + fromToday(-12), { content: '전역하면 하고 싶은 것\n1. 운전면허 따기\n2. 혼자 여행 가기\n3. 포트폴리오 정리' });
        add('memo_' + fromToday(-3), { content: '휴가 때 할 것\n- 첫날은 집에서 푹 쉬기\n- 친구들이랑 저녁\n- 미용실 예약' });
        add('memo_' + fromToday(0), { content: '이번 주 근무표 나오면 휴가 날짜 다시 맞춰보기' });

        add('holiday_data_v2', {
            annual: { granted: 24, used: usage.annual },
            reward: { granted: 5, used: usage.reward },
            comfort: { granted: 2, used: usage.comfort },
            history
        });

        try { localStorage.setItem(ENLIST_KEY, fmt(enlist)); } catch (e) {}

        return { version: 1, lastId, tables: { todos: rows } };
    }

    window.DemoDB = { createClient, reset, defaultEnlistDate };
})();
