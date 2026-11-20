// 마피아 UI (2026-11-09): 로비 모달, 게임 중 상단 바(역할·미션·진행), 회의 판(토론·투표·결과), 종료 안내
import { el } from '../shared/util';
import { modal, withCloseX, confirmModal } from './ui';
import { getThumb, FRAME_W, FRAME_H } from './sprites';
import { spriteTop } from './render';
import { MAFIA_MIN, MAFIA_MAX, TASKS_PER_PLAYER, taskProgress, type MafiaGame } from '../shared/mafia';
import type { MafiaMgr } from './mafia';
import { sfx } from './audio';

export interface MafiaHost { uid: string; nick: string; mafia: MafiaMgr; toast(msg: string, err?: boolean): void; players: Map<string, { st: { n: string } }> }

// 초대 (2026-11-20 건의): 접속 중인 사람 가운데 아직 방에 없는 사람을 골라 부른다. 받는 사람에게는 [참가] 버튼이 달린 알림이 뜬다
function openInvite(h: MafiaHost): void {
  const g = h.mafia.game; if (!g) return;
  const list = [...h.players.entries()].filter(([uid]) => uid !== h.uid && !g.players?.[uid]).map(([uid, rp]) => ({ uid, n: rp.st.n })).sort((a, b) => a.n.localeCompare(b.n, 'ko'));
  const body = el('div', { class: 'mafia-invite-list' });
  const picked = new Set<string>(), boxes: HTMLInputElement[] = [];
  if (!list.length) body.append(el('p', { class: 'muted', text: '초대할 수 있는 접속자가 없어요. (모두 이미 방에 있거나 혼자 접속 중)' }));
  else {
    const all = el('input', { type: 'checkbox' });
    all.onchange = () => { for (const b of boxes) { b.checked = all.checked; if (all.checked) picked.add(b.value); else picked.delete(b.value); } };
    body.append(el('label', { class: 'inv-row all' }, [all, ' 모두 선택']));
    for (const p of list) {
      const cb = el('input', { type: 'checkbox', value: p.uid });
      cb.onchange = () => { if (cb.checked) picked.add(p.uid); else picked.delete(p.uid); };
      boxes.push(cb);
      body.append(el('label', { class: 'inv-row' }, [cb, ' ' + p.n]));
    }
  }
  modal('📨 마피아에 초대', body, list.length ? [
    { label: '초대 보내기', primary: true, onClick: async () => {
      if (!picked.size) { h.toast('초대할 사람을 골라 주세요.', true); return; }
      const n = await h.mafia.invite([...picked]);
      h.toast(n ? `📨 ${n}명에게 초대를 보냈어요.` : '초대를 보내지 못했어요. (같은 사람에게는 10초에 한 번)', !n);
    } },
    { label: '닫기', onClick: () => {} },
  ] : [{ label: '닫기', onClick: () => {} }]);
}

// 내 메뉴 → 🕵 마피아: 게임이 없으면 모집 시작, 로비면 참가/시작, 진행 중이면 상태 안내
export function openMafiaLobby(h: MafiaHost): void {
  const body = el('div', { class: 'mafia-lobby' });
  const m = modal('🕵 마피아', body, [], false);
  m.root.querySelector('.actions')?.remove();
  withCloseX(m);
  let off: (() => void) | null = null;
  const render = () => {
    body.innerHTML = '';
    const g = h.mafia.game;
    if (!g) {
      body.append(el('p', { class: 'muted', style: 'font-size:12px', text: '마피아의 사보타지: 🌫 안개(30초 동안 시민은 자기 둘레만 보인다) · 🔥 불 지르기(두 곳에 불. 60초 안에 둘 다 못 끄면 마피아 승리. 불 옆에서 F 3초). 마피아가 둘이면 서로 🔪 로 알아본다.' }));
      body.prepend(el('p', { text: `어몽어스식 마피아. 마을 전체를 돌아다니며 시민은 미션 ${TASKS_PER_PLAYER}개(금색 테두리 오브젝트 옆에서 F 5초. 화면 밖이면 가장자리 화살표가 가리킨다), 마피아는 몰래 처치(옆에서 F). 시체를 보면 F 로 신고(신고된 시체는 사라짐), 광장 게시판에서 F 로 긴급 소집(1인 1회). 회의에서 과반 투표로 추방. 죽으면 유령이 되어 유령끼리만 보이고 채팅도 유령끼리만.` }));
      body.append(el('p', { class: 'muted', text: `${MAFIA_MIN}~${MAFIA_MAX}명. 6명까지 마피아 1명, 7명부터 2명. 이긴 편은 각 💰50.` }));
      const b = el('button', { class: 'btn primary', text: '모집 시작 (내가 방장)' });
      b.onclick = async () => { b.disabled = true; if (await h.mafia.createLobby()) h.toast('🕵 모집을 시작했어요. 모두에게 알렸습니다.'); else { h.toast('이미 다른 게임이 있거나 만들지 못했어요.', true); b.disabled = false; } };
      body.append(b);
      return;
    }
    const ids = Object.keys(g.players || {});
    const mine = !!g.players?.[h.uid];
    if (g.st === 'lobby') {
      body.append(el('p', { text: `방장 ${g.players?.[g.host]?.n || '?'} · ${ids.length}/${MAFIA_MAX}명 (${MAFIA_MIN}명부터 시작)` }));
      const list = el('div', { class: 'mafia-list' });
      for (const [uid, p] of Object.entries(g.players || {}).sort((a, b) => a[1].j - b[1].j)) list.append(el('span', { class: 'chip' + (uid === g.host ? ' host' : ''), text: (uid === g.host ? '👑 ' : '') + p.n }));
      body.append(list);
      const row = el('div', { class: 'row', style: 'gap:6px;margin-top:8px;flex-wrap:wrap' });
      if (!mine) { const b = el('button', { class: 'btn primary', text: '참가' }); b.onclick = async () => { const r = await h.mafia.join(); if (r === 'full') h.toast('꽉 찼어요.', true); else if (r === 'fail') h.toast('참가하지 못했어요.', true); }; row.append(b); }
      else if (g.host === h.uid) {
        const s = el('button', { class: 'btn primary', text: `시작 (${ids.length}명)` }); s.disabled = ids.length < MAFIA_MIN;
        s.onclick = async () => { s.disabled = true; const r = await h.mafia.startGame(); if (r === 'few') h.toast(`${MAFIA_MIN}명은 모여야 해요.`, true); else if (r === 'fail') h.toast('시작하지 못했어요.', true); else m.close(); };
        const c = el('button', { class: 'btn danger', text: '모집 취소' }); c.onclick = async () => { if (await confirmModal('모집을 취소할까요?')) { await h.mafia.leave(); } };
        row.append(s, c);
      } else { const l = el('button', { class: 'btn', text: '나가기' }); l.onclick = () => h.mafia.leave(); row.append(l); }
      if (mine) { const iv = el('button', { class: 'btn', text: '📨 초대' }); iv.onclick = () => openInvite(h); row.append(iv); }
      body.append(row);
      return;
    }
    // 진행 중 / 종료
    const { done, total } = taskProgress(g);
    body.append(el('p', { text: g.st === 'end' ? `게임 종료: ${g.end?.win === 'm' ? '마피아 승리' : '시민 승리'} (${g.end?.reason || ''})` : `게임 진행 중 · 참가 ${ids.length}명 · 생존 ${Object.values(g.players).filter((p) => p.alive).length}명 · 미션 ${done}/${total}` }));
    if (!mine) body.append(el('p', { class: 'muted', text: '진행 중인 게임에는 들어갈 수 없어요. 끝나면 새로 모집할 수 있습니다.' }));
  };
  off = h.mafia.listen(render);
  const origClose = m.close; m.close = () => { off?.(); origClose(); };
  render();
}

// 게임 중 상단 바 + 회의 판 (DOM, 참가자에게만)
export class MafiaHud {
  private bar: HTMLElement | null = null;
  private meet: HTMLElement | null = null;
  private lastSig = '';
  constructor(private h: MafiaHost) {}

  update(): void {
    const g = this.h.mafia.game;
    const me = this.h.mafia.me;
    if (!g || g.st === 'lobby' || !me.in) { this.clear(); return; }
    if (!this.bar) { this.bar = el('div', { id: 'mafia-bar' }); document.body.append(this.bar); }
    const { done, total } = taskProgress(g);
    const alive = Object.values(g.players).filter((p) => p.alive).length;
    const role = me.mafia ? '🔪 마피아' : '👤 시민';
    const mf = this.h.mafia;
    const mates = me.mafia ? Object.entries(g.players).filter(([u]) => mf.isMate(u)).map(([, p]) => p.n) : [];
    const status = (me.ghost ? '👻 유령 (미션은 계속 할 수 있어요)' : me.mafia ? `처치 ${mf.killCooldownLeft() > 0 ? Math.ceil(mf.killCooldownLeft() / 1000) + '초 뒤' : '가능 (옆에서 F)'}` : '오브젝트 옆에서 F 5초') + (mates.length ? ` · 동료 🔪 ${mates.join(', ')}` : '');
    // 사보타지 (2026-11-20): 걸려 있으면 모두에게 한 줄, 살아 있는 마피아에게는 거는 버튼
    const sabSt = mf.sabNow(), sabSec = Math.ceil(mf.sabLeftMs() / 1000);
    const sabTxt = sabSt === 'fire' ? `🔥 불이야! ${sabSec}초 안에 두 곳을 꺼야 해요 · 꺼진 곳 ${mf.fireSpots().filter((f) => f.out).length}/2 (불 옆에서 F 3초)` : sabSt === 'fog' ? `🌫 안개 ${sabSec}초` : '';
    const canSab = mf.canSabotage(), cdFog = Math.ceil(mf.sabCooldownLeft(1) / 1000), cdFire = Math.ceil(mf.sabCooldownLeft(2) / 1000);
    const myTasks = this.h.mafia.myTasks();
    const taskTxt = me.mafia ? '' : ' · 내 미션 ' + myTasks.map((t) => `${t.done ? '✅' : '⬜'} ${t.spot.def.verb}`).join(' ');
    const hold = this.h.mafia.holdProgress();
    const left = Math.max(0, 15 * 60 * 1000 - (Date.now() - g.at));
    const sig = `${g.st}|${role}|${status}|${done}/${total}|${alive}|${taskTxt}|${Math.round(hold * 20)}|${Math.floor(left / 1000)}|${g.end?.win || ''}|${sabTxt}|${canSab ? cdFog + '/' + cdFire : ''}`;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.bar.innerHTML = '';
      this.bar.className = me.mafia ? 'mafia' : me.ghost ? 'ghost' : '';
      const top = el('div', { class: 'row' });
      top.append(el('b', { text: `🕵 ${role}` }), el('span', { text: ` · ${status}` }), el('span', { class: 'sp' }), el('span', { text: `생존 ${alive} · 미션 ${done}/${total} · ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` }));
      this.bar.append(top);
      const prog = el('div', { class: 'prog' }); prog.append(el('div', { class: 'fill', style: `width:${total ? (done / total) * 100 : 0}%` })); this.bar.append(prog);
      if (taskTxt) this.bar.append(el('div', { class: 'tasks', text: taskTxt.slice(3) }));
      if (sabTxt) this.bar.append(el('div', { class: 'sabline' + (sabSt === 'fire' ? ' fire' : ''), text: sabTxt }));
      if (canSab && g.st === 'play') {
        // 버튼은 1초마다 다시 그려지므로 누르는 순간(pointerdown)에 받는다
        const mk = (kind: 1 | 2, label: string, cd: number) => {
          const b = el('button', { class: 'btn small', text: cd > 0 ? `${label} (${cd}초)` : label });
          b.disabled = cd > 0 || sabSt === 'fire';
          b.onpointerdown = (e) => { e.preventDefault(); if (b.disabled) return; b.disabled = true; void mf.sabotage(kind).then((ok) => { if (!ok) this.h.toast('지금은 쓸 수 없어요.', true); }); };
          return b;
        };
        this.bar.append(el('div', { class: 'sab' }, [mk(1, '🌫 안개', cdFog), mk(2, '🔥 불 지르기', cdFire)]));
      }
      if (hold > 0) { const hp = el('div', { class: 'prog hold' }); hp.append(el('div', { class: 'fill', style: `width:${hold * 100}%` })); this.bar.append(el('div', { class: 'tasks', text: `${mf.holdingFire() ? '불 끄기' : mf.holding()?.def.verb || ''} 진행 중… (움직이면 취소)` }), hp); }
      if (g.st === 'end' && g.end) this.bar.append(el('div', { class: 'end', text: `${g.end.win === 'm' ? '🔪 마피아 승리' : '👤 시민 승리'} — ${g.end.reason}` }));
    }
    this.updateMeet(g);
  }
  // 회의 중 채팅 (world 가 log 이벤트에서 넘겨준다): 그 사람 얼굴 옆 말풍선으로 MEET_BUBBLE_MS 동안
  private bubbles = new Map<string, { text: string; at: number }>();
  chat(uid: string, text: string): void {
    this.bubbles.set(uid, { text, at: performance.now() });
    this.renderBubbles();
  }
  private renderBubbles(): void {
    if (!this.meet) return;
    const now = performance.now();
    for (const b of this.meet.querySelectorAll<HTMLElement>('.card')) {
      const uid = b.dataset.uid!;
      const bb = b.querySelector<HTMLElement>('.bubble'); if (!bb) continue;
      const m = this.bubbles.get(uid);
      const on = !!m && now - m.at < MEET_BUBBLE_MS;
      bb.classList.toggle('on', on);
      if (on && m) bb.textContent = m.text;
    }
  }
  // 아바타 얼굴 (머리 부분 3배 확대)
  private face(avatar: string, size = 48): HTMLCanvasElement {
    const spr = getThumb(avatar);
    const top = spriteTop(spr);
    const sh = Math.min(16, FRAME_H - top);
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const c = cv.getContext('2d')!; c.imageSmoothingEnabled = false;
    const k = size / 16;
    c.drawImage(spr, 0, top, FRAME_W, sh, Math.round((size - FRAME_W * k) / 2), 0, Math.round(FRAME_W * k), Math.round(sh * k));
    return cv;
  }
  // 어몽어스식 회의 판 (2026-11-10): 전체 화면, 얼굴 카드 격자, 죽은 사람은 ✖, 채팅 말풍선, 카드마다 지목 버튼. 표 수와 누가 찍었는지는 결과 때 공개
  private updateMeet(g: MafiaGame): void {
    const mp = this.h.mafia.meetPhase();
    if (this.bar) this.bar.style.display = mp && g.meet ? 'none' : ''; // 회의 판이 떠 있는 동안 상단 바는 숨긴다 (겹침)
    if (!mp || !g.meet) { if (this.meet) { this.meet.remove(); this.meet = null; this.bubbles.clear(); document.body.classList.remove('mafia-meeting'); } return; }
    // 회의 판은 #app 안에 붙인다: 그래야 채팅창·위쪽 표시(#hud, z 23)가 판(z 22) 위에 온다. body 에 붙였더니 판이 채팅창을 덮어 폰에서 입력창을 누를 수 없었다 (2026-11-20 제보)
    if (!this.meet) { this.meet = el('div', { id: 'mafia-meet' }); (document.getElementById('app') || document.body).append(this.meet); document.body.classList.add('mafia-meeting'); this.meetSig = ''; sfx('alarm'); } // 회의가 열리는 순간 경보
    const votes = g.meet.votes || {};
    const myVote = votes[this.h.uid];
    const me = this.h.mafia.me;
    const sig = `${mp.phase}|${Math.ceil(mp.leftMs / 1000)}|${JSON.stringify(votes)}|${g.meet.result ? 'r' + (g.meet.result.out || '') : ''}|${Object.values(g.players).map((p) => (p.alive ? 1 : 0)).join('')}`;
    if (sig === this.meetSig) { this.renderBubbles(); return; }
    this.meetSig = sig;
    const box = this.meet; box.innerHTML = '';
    const who = g.players[g.meet.by]?.n || '?';
    const title = g.meet.kind === 'report' ? `🩸 ${who} 님이 ${g.meet.body ? (g.players[g.meet.body]?.n || '?') + ' 님의 시체를' : '시체를'} 발견!` : `🚨 ${who} 님이 긴급 소집!`;
    box.append(el('div', { class: 'title', text: title }));
    const r = mp.phase === 'result' ? g.meet.result : null;
    if (r) box.append(el('div', { class: 'phase', text: r.out ? `${g.players[r.out]?.n || '?'} 님이 추방됐습니다.` : r.tie ? '동률이라 아무도 추방되지 않았습니다.' : '과반이 안 되어 아무도 추방되지 않았습니다.' }));
    else box.append(el('div', { class: 'phase', text: mp.phase === 'discuss' ? `토론 ${Math.ceil(mp.leftMs / 1000)}초 · 채팅으로 이야기하세요 (투표는 지금도 가능)` : `투표 ${Math.ceil(mp.leftMs / 1000)}초` }));
    const canVote = me.alive && !myVote && !r;
    // 투표한 사람 → 찍은 대상 (결과 때 공개)
    const votersOf = (target: string) => Object.entries(votes).filter(([, t]) => t === target).map(([v]) => v);
    const cards = el('div', { class: 'cards' });
    const order = Object.entries(g.players).sort((a, b) => Number(b[1].alive) - Number(a[1].alive) || a[1].j - b[1].j);
    for (const [uid, p] of order) {
      const dead = !p.alive || (r?.out === uid);
      const card = el('div', { class: 'card' + (dead ? ' dead' : '') + (uid === this.h.uid ? ' me' : '') + (votes[uid] !== undefined ? ' voted' : '') });
      card.dataset.uid = uid;
      const faceBox = el('div', { class: 'facebox' });
      faceBox.append(this.face(p.a));
      if (dead) faceBox.append(el('div', { class: 'x', text: '✖' }));
      if (!dead && votes[uid] !== undefined && !r) faceBox.append(el('div', { class: 'tick', text: '✓' }));
      card.append(faceBox);
      card.append(el('div', { class: 'nm', text: p.n + (uid === this.h.uid ? ' (나)' : '') + (this.h.mafia.isMate(uid) ? ' 🔪' : '') + (uid === g.meet.by ? ' 📣' : '') }));
      card.append(el('div', { class: 'bubble' }));
      if (r) {
        // 결과: 받은 표 수 + 누가 찍었는지 (작은 얼굴)
        const vs = votersOf(uid);
        if (vs.length) {
          const row = el('div', { class: 'got' });
          row.append(el('b', { text: `${vs.length}표` }));
          for (const v of vs) { const f = this.face(g.players[v]?.a || 'm01', 20); f.title = g.players[v]?.n || ''; row.append(f); }
          card.append(row);
        } else if (!dead || r.out === uid) card.append(el('div', { class: 'got muted', text: '0표' }));
      } else if (!dead) {
        const b = el('button', { class: 'btn small' + (myVote === uid ? ' on' : ''), text: myVote === uid ? '내 표' : '지목' });
        b.disabled = !canVote || uid === this.h.uid;
        b.onclick = () => { void this.h.mafia.vote(uid); };
        card.append(b);
      }
      cards.append(card);
    }
    box.append(cards);
    const foot = el('div', { class: 'foot' });
    if (r) {
      const sk = votersOf('skip');
      if (sk.length) { const row = el('div', { class: 'got' }); row.append(el('b', { text: `기권 ${sk.length}표` })); for (const v of sk) { const f = this.face(g.players[v]?.a || 'm01', 20); f.title = g.players[v]?.n || ''; row.append(f); } foot.append(row); }
    } else {
      const skip = el('button', { class: 'btn small' + (myVote === 'skip' ? ' on' : ''), text: myVote === 'skip' ? '기권함' : '기권' });
      skip.disabled = !canVote;
      skip.onclick = () => { void this.h.mafia.vote('skip'); };
      foot.append(skip);
      if (!me.alive) foot.append(el('span', { class: 'muted', text: '유령은 투표할 수 없어요. 유령 채팅은 유령끼리만 보입니다.' }));
      else if (myVote) foot.append(el('span', { class: 'muted', text: '투표했어요. 모두 투표하거나 시간이 끝나면 결과가 나옵니다.' }));
    }
    box.append(foot);
    this.renderBubbles();
  }
  private meetSig = '';
  clear(): void { this.bar?.remove(); this.bar = null; this.meet?.remove(); this.meet = null; this.lastSig = ''; this.meetSig = ''; this.bubbles.clear(); document.body.classList.remove('mafia-meeting'); }
}
const MEET_BUBBLE_MS = 6000;
