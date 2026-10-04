"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get DEFAULT_WELLNESS () {
        return DEFAULT_WELLNESS;
    },
    get MAX_ELAPSED_SEC () {
        return MAX_ELAPSED_SEC;
    },
    get elapsedFor () {
        return elapsedFor;
    },
    get gameTile () {
        return gameTile;
    },
    get leaderboardTile () {
        return leaderboardTile;
    },
    get nextUnlockLabel () {
        return nextUnlockLabel;
    },
    get peopleBoard () {
        return peopleBoard;
    },
    get streakFrom () {
        return streakFrom;
    },
    get teamBoard () {
        return teamBoard;
    },
    get weekLabel () {
        return weekLabel;
    },
    get weekRange () {
        return weekRange;
    }
});
const _shared = require("@lexisora/shared");
const _dates = require("../common/dates");
const MAX_ELAPSED_SEC = 3600;
const DEFAULT_WELLNESS = {
    enabledGames: [
        'queens',
        'sudoku6',
        'wordladder'
    ],
    unlockTime: '00:00',
    breakOnly: false
};
function weekRange(key, which = 'current') {
    const start = (0, _dates.addDaysKey)((0, _dates.weekStartKey)(key), which === 'last' ? -7 : 0);
    return {
        start,
        end: (0, _dates.addDaysKey)(start, 6)
    };
}
const short = (key)=>{
    const d = (0, _dates.dateOnly)(key);
    return `${d.getUTCDate()} ${_dates.MONTHS_SHORT[d.getUTCMonth()]}`;
};
function weekLabel(range, which) {
    return `${which === 'current' ? 'This week' : 'Last week'} · ${short(range.start)} – ${short(range.end)}`;
}
function streakFrom(playedDays, today) {
    const days = new Set(playedDays);
    let cursor = days.has(today) ? today : (0, _dates.addDaysKey)(today, -1);
    let n = 0;
    while(days.has(cursor)){
        n++;
        cursor = (0, _dates.addDaysKey)(cursor, -1);
    }
    return n;
}
function elapsedFor(startedAt, now = new Date()) {
    return Math.min(MAX_ELAPSED_SEC, Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000)));
}
function teamBoard(rows, depts, myDepartmentId) {
    const agg = new Map();
    for (const r of rows){
        const k = r.departmentId ?? '__none';
        const a = agg.get(k) ?? {
            points: 0,
            players: new Set()
        };
        a.points += r.points;
        a.players.add(r.employeeId);
        agg.set(k, a);
    }
    const out = depts.filter((d)=>d.headcount > 0).map((d)=>{
        const a = agg.get(d.id);
        const points = a?.points ?? 0;
        return {
            departmentId: d.id,
            department: d.name,
            players: a?.players.size ?? 0,
            headcount: d.headcount,
            points,
            scorePerMember: Math.round(points / d.headcount * 100) / 100,
            rank: null,
            mine: d.id === myDepartmentId
        };
    });
    out.sort((a, b)=>b.scorePerMember - a.scorePerMember || b.players - a.players || a.department.localeCompare(b.department));
    let rank = 0;
    for (const t of out)if (t.points > 0) t.rank = ++rank;
    const none = agg.get('__none');
    if (none) out.push({
        departmentId: '',
        department: 'Unassigned',
        players: none.players.size,
        headcount: none.players.size,
        points: none.points,
        scorePerMember: Math.round(none.points / Math.max(1, none.players.size) * 100) / 100,
        rank: null,
        mine: myDepartmentId === null
    });
    return out;
}
function peopleBoard(rows, people, me, limit = 20) {
    const agg = new Map();
    for (const r of rows){
        const a = agg.get(r.employeeId) ?? {
            points: 0,
            games: 0
        };
        a.points += r.points;
        a.games += 1;
        agg.set(r.employeeId, a);
    }
    return [
        ...agg.entries()
    ].map(([employeeId, a])=>({
            employeeId,
            ...a,
            p: people.get(employeeId)
        })).sort((a, b)=>b.points - a.points || b.games - a.games || (a.p?.name ?? '').localeCompare(b.p?.name ?? '')).slice(0, limit).map((r, i)=>({
            rank: i + 1,
            employeeId: r.employeeId,
            name: r.p?.name ?? 'Anonymous',
            initials: r.p?.initials ?? '?',
            department: r.p?.department ?? null,
            points: r.points,
            games: r.games,
            mine: r.employeeId === me
        }));
}
function gameTile(key, s) {
    const info = _shared.GAME_INFO[key];
    if (!s) return {
        key,
        kicker: info.kicker,
        title: info.title,
        sub: info.sub,
        cta: 'Play',
        state: 'NEW',
        points: null,
        elapsedSec: null
    };
    if (!s.completedAt) return {
        key,
        kicker: info.kicker,
        title: info.title,
        sub: info.sub,
        cta: 'Resume',
        state: 'STARTED',
        points: null,
        elapsedSec: null
    };
    if (s.revealed) return {
        key,
        kicker: info.kicker,
        title: info.title,
        sub: 'Revealed · 0 pts',
        cta: 'Review',
        state: 'REVEALED',
        points: 0,
        elapsedSec: s.elapsedSec
    };
    return {
        key,
        kicker: info.kicker,
        title: info.title,
        sub: `Solved in ${(0, _shared.formatGameClock)(s.elapsedSec ?? 0)} · +${s.points} pts`,
        cta: 'Review',
        state: 'SOLVED',
        points: s.points,
        elapsedSec: s.elapsedSec
    };
}
function leaderboardTile(leader) {
    return {
        key: 'leaderboard',
        kicker: 'Weekly',
        title: 'Team leaderboard',
        sub: leader ? `${leader} leads this week.` : 'No games played yet this week.',
        cta: 'View',
        state: 'BOARD',
        points: null,
        elapsedSec: null
    };
}
function nextUnlockLabel(now, unlock = '00:00') {
    const ist = new Date(now.getTime() + 330 * 60_000);
    const [h, m] = unlock.split(':').map(Number);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    let left = h * 60 + m - mins;
    if (left <= 0) left += 24 * 60;
    const hh = Math.floor(left / 60);
    const mm = left % 60;
    return `New set unlocks at ${unlock} IST · in ${hh ? `${hh}h ` : ''}${mm}m`;
}

//# sourceMappingURL=wellness.rules.js.map