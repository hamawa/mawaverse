import { ref, get } from 'firebase/database';
import { db } from '../firebase/app';
import { el, fmtDateTime } from '../shared/util';
import { modal } from './ui';
import { serverNow } from '../firebase/db';
import { RARITY_NAME, RARITY_COLOR, RARITY_POINTS, MYTHIC, TIME_LABEL, type Collection, type BookEntry, type WeekEntry, type BestEntry } from '../shared/collection';
import { fishColl, fmtSize, weekKey, fishById } from '../shared/fish';
import { bugColl, fmtBugSize } from '../shared/bugs';
import { prevContestWindow, type ContestEntry, type ContestResult } from '../shared/contest';
import type { ContestMgr } from './contest';
import type { TossWeekEntry } from './toss';
import { CATCH_LOG_MAX, type CatchLog } from './catchlog';

export interface FishUser { uid: string; nick: string; contest?: ContestMgr; catchLog?: CatchLog }

// 도감 종류 (물고기 / 곤충). DB 경로와 표시만 다르고 구조는 같다
interface BookKind { base: 'fish' | 'bug'; coll: Collection; label: string; unit: (n: number) => string; icon: string; catchWord: string }
const KINDS: Record<'fish' | 'bug', BookKind> = {
  fish: { base: 'fish', coll: fishColl, label: '물고기', unit: fmtSize, icon: '🐟', catchWord: '잡음' },
  bug: { base: 'bug', coll: bugColl, label: '곤충', unit: fmtBugSize, icon: '🐛', catchWord: '잡음' },
};

// 도감 + 주간 랭킹 + 대회 모달
export function openFishBook(user: FishUser): void {
  const body = el('div');
  const m = modal('📖 도감', body, [{ label: '닫기', onClick: () => {} }], true);
  const tabs = el('div', { class: 'tabs' });
  const tFish = el('button', { class: 'active', text: '🐟 물고기' });
  const tBug = el('button', { text: '🐛 곤충' });
  const tRank = el('button', { text: '주간 랭킹' });
  const tCon = el('button', { text: '🏁 대회' });
  const tLog = el('button', { text: '📜 내 기록' });
  tabs.append(tFish, tBug, tRank, tCon);
  if (user.catchLog) tabs.append(tLog);
  const pane = el('div');
  body.append(tabs, pane);
  type Tab = 'fish' | 'bug' | 'rank' | 'contest' | 'log';
  const btns: Record<Tab, HTMLButtonElement> = { fish: tFish, bug: tBug, rank: tRank, contest: tCon, log: tLog };
  const setTab = (which: Tab) => {
    (Object.keys(btns) as Tab[]).forEach((k) => btns[k].classList.toggle('active', k === which));
    if (which === 'fish' || which === 'bug') showBook(KINDS[which]); else if (which === 'rank') showRank(); else if (which === 'log') showLog(); else showContest();
  };
  (Object.keys(btns) as Tab[]).forEach((k) => { btns[k].onclick = () => setTab(k); });

  // 내 낚시·채집 기록: 채팅에 안 남기는 대신 여기서 본다 (브라우저에 최근 CATCH_LOG_MAX 건)
  const showLog = () => {
    pane.innerHTML = '';
    const log = user.catchLog;
    if (!log) return;
    const list = log.list();
    const head = el('div', { class: 'muted', style: 'margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px' });
    head.append(el('span', { text: `이 브라우저에서 잡은 최근 ${list.length}건 (최대 ${CATCH_LOG_MAX}건, 이 기기에만 저장)` }));
    const clr = el('button', { class: 'btn small', text: '지우기' });
    clr.onclick = () => { log.clear(); showLog(); };
    head.append(clr);
    pane.append(head);
    if (!list.length) { pane.append(el('p', { class: 'muted', text: '아직 기록이 없습니다. 물가에서 F 로 낚시, 풀밭 벌레 옆에서 F 로 채집!' })); return; }
    const box = el('div', { class: 'catch-log' });
    let lastDay = '';
    for (const e of list) {
      const d = new Date(e.ts);
      const day = `${d.getMonth() + 1}/${d.getDate()}`;
      if (day !== lastDay) { lastDay = day; box.append(el('div', { class: 'day', text: day })); }
      const row = el('div', { class: 'row' });
      row.append(el('span', { class: 't', text: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }), el('span', { text: e.text }));
      box.append(row);
    }
    pane.append(box);
  };

  const showBook = async (k: BookKind) => {
    pane.innerHTML = '<p class="muted">불러오는 중...</p>';
    let book: Record<string, BookEntry> = {}, best: Record<string, BestEntry> = {}, week: WeekEntry | null = null;
    try {
      const [b, bs, wk] = await Promise.all([get(ref(db, `${k.base}/book/${user.uid}`)), get(ref(db, `${k.base}/best`)), get(ref(db, `${k.base}/week/${weekKey()}/${user.uid}`))]);
      book = b.val() || {}; best = bs.val() || {}; week = wk.val();
    } catch { pane.innerHTML = '<p class="error">기록을 불러오지 못했습니다.</p>'; return; }
    pane.innerHTML = '';
    const all = k.coll.list();
    // 비활성 종은 이미 잡은 사람에게만 보인다. 관리자가 삭제한 종은 '사라진 …'
    const visible = all.filter((f) => f.on !== false || book[f.id]);
    const mainList = visible.filter((f) => !f.junk), junkList = visible.filter((f) => f.junk);
    const known = new Set(all.map((f) => f.id));
    const gone = Object.entries(book).filter(([id]) => !known.has(id));
    const found = mainList.filter((f) => book[f.id]).length, junkFound = junkList.filter((f) => book[f.id]).length;
    const total = Object.values(book).reduce((s, e) => s + (e.c || 0), 0);
    pane.append(el('div', { class: 'muted', style: 'margin-bottom:8px', text: `${k.label} ${found}/${mainList.length}종 · 꽝 ${junkFound}/${junkList.length}종 · 총 ${total}마리 · 이번 주 ${week?.p || 0}점${k.base === 'bug' ? ' · 풀밭·꽃밭에서 걸어가 옆에서 F (달리면 도망감)' : ''}` }));
    const grid = el('div', { class: 'fish-grid' });
    for (const f of [...mainList, ...junkList]) {
      const mine = book[f.id];
      const off = f.on === false;
      const card = el('div', { class: 'fish-card' + (mine ? '' : ' locked') + (off ? ' off' : '') });
      const nm = el('div', { class: 'nm' + (!f.junk && f.rarity >= MYTHIC ? ' myth-text' : ''), text: f.name, style: `color:${f.junk ? 'var(--muted)' : RARITY_COLOR[f.rarity]}` }); // 신화는 무지개 반짝임
      const sub = f.junk ? '꽝' : `${RARITY_NAME[f.rarity]} · ${RARITY_POINTS[f.rarity]}점${f.time ? ' · ' + TIME_LABEL[f.time] : ''}`;
      card.append(el('div', { class: 'ic', text: f.icon }), nm, el('div', { class: 'meta', text: sub }));
      if (mine) card.append(el('div', { class: 'meta', text: f.junk ? `${mine.c}개` : `${mine.c}마리 · 내 최대 ${k.unit(mine.m)}` }));
      else card.append(el('div', { class: 'meta', text: '아직 못 잡음' }));
      if (off) card.append(el('div', { class: 'meta', text: '지금은 안 나옴' }));
      if (!f.junk) { const b = best[f.id]; card.append(el('div', { class: 'meta best', text: b ? `🏆 ${b.n} ${k.unit(b.s)}` : '🏆 기록 없음' })); }
      card.title = f.desc;
      card.onclick = () => { const d = card.querySelector('.desc'); if (d) d.remove(); else card.append(el('div', { class: 'meta desc', text: f.desc })); };
      grid.append(card);
    }
    for (const [, e] of gone) {
      const card = el('div', { class: 'fish-card off' });
      card.append(el('div', { class: 'ic', text: '❓' }), el('div', { class: 'nm', text: `사라진 ${k.label}` }), el('div', { class: 'meta', text: '더 이상 나오지 않는 종' }), el('div', { class: 'meta', text: `${e.c}마리${e.m ? ' · 내 최대 ' + k.unit(e.m) : ''}` }));
      grid.append(card);
    }
    pane.append(grid);
  };

  const rankTable = (rows: [string, WeekEntry][], medals = false) => {
    const t = el('table', { class: 'fish-rank' });
    t.innerHTML = '<thead><tr><th>#</th><th>닉네임</th><th>점수</th><th>마릿수</th><th>마지막</th></tr></thead>';
    const tb = el('tbody');
    const md = ['🥇', '🥈', '🥉'];
    rows.slice(0, 30).forEach(([uid, r], i) => {
      const tr = el('tr', { class: uid === user.uid ? 'me' : '' });
      tr.append(el('td', { text: medals && i < 3 ? md[i] : String(i + 1) }), el('td', { text: r.n + (uid === user.uid ? ' (나)' : '') }), el('td', { text: String(r.p) }), el('td', { text: String(r.c) }), el('td', { text: r.at ? fmtDateTime(r.at).slice(5, 16) : '-' }));
      tb.append(tr);
    });
    t.append(tb);
    return t;
  };
  const sortRows = (v: Record<string, WeekEntry> | null) => Object.entries(v || {}).sort((a, b) => (b[1].p - a[1].p) || (b[1].c - a[1].c) || (a[1].at - b[1].at));

  // 주간 랭킹: 물고기 / 곤충 따로
  const showRank = async () => {
    pane.innerHTML = '<p class="muted">불러오는 중...</p>';
    const wk = weekKey();
    let fish: [string, WeekEntry][] = [], bug: [string, WeekEntry][] = [], toss: [string, TossWeekEntry][] = [];
    try {
      const [f, b, t] = await Promise.all([get(ref(db, `fish/week/${wk}`)), get(ref(db, `bug/week/${wk}`)), get(ref(db, `toss/week/${wk}`))]);
      fish = sortRows(f.val()); bug = sortRows(b.val());
      toss = Object.entries((t.val() || {}) as Record<string, TossWeekEntry>).sort((x, y) => (y[1].h - x[1].h) || (x[1].t - y[1].t));
    } catch { pane.innerHTML = '<p class="error">랭킹을 불러오지 못했습니다.</p>'; return; }
    pane.innerHTML = '';
    const monday = `${wk.slice(0, 4)}-${wk.slice(4, 6)}-${wk.slice(6, 8)}`;
    pane.append(el('div', { class: 'muted', style: 'margin-bottom:8px', text: `${monday} 주 · 월요일에 새로 시작 · 점수: 일반 1 · 희귀 5 · 영웅 20 · 전설 100` }));
    for (const [title, rows] of [['🐟 낚시', fish], ['🐛 곤충 채집', bug]] as [string, [string, WeekEntry][]][]) {
      pane.append(el('h4', { style: 'margin:6px 0 4px', text: title }));
      if (!rows.length) pane.append(el('p', { class: 'muted', text: '이번 주에는 아직 기록이 없어요. 첫 기록을 세워보세요!' }));
      else pane.append(rankTable(rows));
    }
    pane.append(el('h4', { style: 'margin:6px 0 4px', text: '🧸 말랑이 명중' }));
    if (!toss.length) pane.append(el('p', { class: 'muted', text: '아직 아무도 던지지 않았어요. G 키(모바일 🧸)로 앞사람에게!' }));
    else {
      const t = el('table', { class: 'fish-rank' });
      t.innerHTML = '<thead><tr><th>#</th><th>닉네임</th><th>명중</th><th>던짐</th><th>명중률</th></tr></thead>';
      const tb = el('tbody');
      toss.slice(0, 30).forEach(([uid, r], i) => {
        const tr = el('tr', { class: uid === user.uid ? 'me' : '' });
        tr.append(el('td', { text: String(i + 1) }), el('td', { text: r.n + (uid === user.uid ? ' (나)' : '') }), el('td', { text: String(r.h) }), el('td', { text: String(r.t) }), el('td', { text: r.t ? Math.round((r.h / r.t) * 100) + '%' : '-' }));
        tb.append(tr);
      });
      t.append(tb); pane.append(t);
    }
  };

  // 대회: 진행 중이면 실시간 순위, 아니면 지난 대회 결과
  const showContest = async () => {
    const cm = user.contest;
    pane.innerHTML = '<p class="muted">불러오는 중...</p>';
    if (!cm) { pane.innerHTML = '<p class="muted">대회 정보를 볼 수 없습니다.</p>'; return; }
    const act = cm.active();
    const win = act || prevContestWindow(cm.cfg(), serverNow());
    let v: Record<string, ContestEntry | ContestResult> = {};
    if (win) { try { v = (await get(ref(db, `fish/contest/${win.key}`))).val() || {}; } catch { pane.innerHTML = '<p class="error">대회 기록을 불러오지 못했습니다.</p>'; return; } }
    pane.innerHTML = '';
    pane.append(el('div', { class: 'muted', style: 'margin-bottom:8px', text: `${cm.statusText()} · 대회 중 잡은 물고기만 집계` }));
    if (!win) return;
    const result = v.result as ContestResult | undefined;
    const rows = sortRows(Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'result')) as Record<string, WeekEntry>);
    pane.append(el('h4', { style: 'margin:4px 0 6px', text: `${act ? '진행 중' : '지난'} 대회 (${win.key.slice(4, 6)}/${win.key.slice(6, 8)})${result ? ' · 결과 확정' : ''}` }));
    if (!rows.length) { pane.append(el('p', { class: 'muted', text: act ? '아직 아무도 낚지 못했어요. 첫 기록을 세워보세요!' : '참가자가 없었습니다.' })); return; }
    pane.append(rankTable(rows, true));
  };

  showBook(KINDS.fish);
  void m;
}

// 다른 사람 프로필에 보여줄 한 줄 요약
export async function fishSummaryOf(uid: string): Promise<string> {
  try {
    const [b, w, bb] = await Promise.all([get(ref(db, `fish/book/${uid}`)), get(ref(db, `fish/week/${weekKey()}/${uid}`)), get(ref(db, `bug/book/${uid}`))]);
    const book = (b.val() || {}) as Record<string, BookEntry>;
    const kinds = Object.keys(book).filter((id) => fishById(id) && !fishById(id)!.junk).length;
    const total = Object.values(book).reduce((s, e) => s + (e.c || 0), 0);
    const week = w.val() as WeekEntry | null;
    const bugs = (bb.val() || {}) as Record<string, BookEntry>;
    const bugKinds = Object.keys(bugs).filter((id) => bugColl.byId(id) && !bugColl.byId(id)!.junk).length;
    return `낚시: ${kinds}종 발견, ${total}마리, 이번 주 ${week?.p || 0}점 · 곤충: ${bugKinds}종`;
  } catch { return '낚시: 기록을 볼 수 없음'; }
}
