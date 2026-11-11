import { ref, push, update, remove, query, orderByChild, endAt, limitToFirst, get, onChildAdded, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/app';
import { serverNow, onNewChild } from '../firebase/db';
import { uidByNick } from '../firebase/auth';
import { CHAT_MAX_LEN, MSG_MIN_INTERVAL_MS } from '../shared/config';
import type { ChatMsg, WhisperMsg, GhostMsg } from '../shared/types';
import type { WorldCtx } from './state';
import { MAIN_MAP_ID } from '../shared/maps';

export class Chat {
  private unsubs: (() => void)[] = [];
  private lastSent = 0;
  private lastWhisperFrom: string | null = null;
  private trimTimer = 0;

  constructor(private w: WorldCtx) {}

  start(): void {
    const w = this.w;
    // 과거 기록은 불러오지 않는다: 내가 들어온 뒤에 쓰인 메시지만 받는다
    this.unsubs.push(onNewChild('chat/public', serverNow(), 30, (s) => this.onPublic(s.val() as ChatMsg)));
    this.unsubs.push(onChildAdded(ref(db, `chat/whisper/${w.uid}`), (s) => {
      const m = s.val() as WhisperMsg;
      remove(s.ref).catch(() => {});
      this.onWhisper(m);
    }));
    this.trimTimer = window.setInterval(() => this.maybeTrim(), 10 * 60 * 1000);
    window.setTimeout(() => this.maybeTrim(), 20000);
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.ghostUnsub?.(); this.ghostUnsub = null;
    clearInterval(this.trimTimer);
  }

  // 말풍선을 띄울 보낸 사람 자리: 지금 나와 같은 맵에 있을 때만 (다른 맵 좌표가 내 화면에 겹쳐 보이지 않게)
  private senderTile(uid: string, fx: number, fy: number, sentOn?: { m?: string | null }): [number, number] | null {
    const w = this.w;
    if (sentOn && !w.onMyMap(sentOn)) return null;
    const p = w.players.get(uid);
    if (!p) return sentOn ? [fx, fy] : null;
    return w.onMyMap(p.st) ? [p.toX, p.toY] : null;
  }

  // 기본 채팅은 거리·맵과 상관없이 접속자 모두에게 보인다 (2026-11-03, 사용자 결정: 전체 채팅 채널을 따로 두지 않는다).
  // 말풍선은 보낸 사람이 같은 맵의 화면 안에 있을 때만. 옛 클라이언트가 보낸 c:'all' 도 같은 취급. m 이 없으면 기본 맵에서 보낸 것
  private onPublic(m: ChatMsg): void {
    const w = this.w;
    const self = m.u === w.uid;
    w.events.emit('log', { channel: 'near', uid: m.u, from: m.n, text: m.t, ts: m.ts, self });
    const at = this.senderTile(m.u, m.x, m.y, m);
    if (!self && at && w.isTileVisible(at[0], at[1])) w.setBubble(m.u, { text: m.t, kind: 'near', at: performance.now() });
  }

  private onWhisper(m: WhisperMsg): void {
    const w = this.w;
    this.lastWhisperFrom = m.fn;
    w.events.emit('log', { channel: 'w', uid: m.f, from: m.fn, to: w.profile.nick, text: m.t, ts: m.ts });
    const at = this.senderTile(m.f, m.x, m.y);
    if (at && w.isTileVisible(at[0], at[1])) w.setBubble(m.f, { text: m.t, kind: 'w', at: performance.now() });
  }

  async send(raw: string): Promise<void> {
    const w = this.w;
    let text = raw.trim();
    if (!text) return;
    const now = Date.now();
    if (now - this.lastSent < MSG_MIN_INTERVAL_MS) { w.toast('너무 빠르게 보내고 있습니다.', true); return; }
    let channel: 'near' | 'w' = 'near';
    let targetNick = '';
    const m = /^\/(w|all|r)\b\s*(.*)$/s.exec(text);
    if (m) {
      const cmd = m[1];
      const rest = m[2].trim();
      if (cmd === 'all') { text = rest; } // 예전 명령: 이제 기본 채팅이 모두에게 보이므로 그냥 보낸다
      else if (cmd === 'r') {
        if (!this.lastWhisperFrom) { w.toast('답장할 귓속말이 없습니다.', true); return; }
        channel = 'w'; targetNick = this.lastWhisperFrom; text = rest;
      } else {
        const sp = rest.indexOf(' ');
        if (sp < 0) { w.toast('사용법: /w 닉네임 메시지', true); return; }
        channel = 'w'; targetNick = rest.slice(0, sp).trim(); text = rest.slice(sp + 1).trim();
      }
    } else if (text.startsWith('/')) { w.toast('알 수 없는 명령어입니다. (/w /r)', true); return; }
    if (!text) return;
    // 포탈로 맵을 옮기는 중: 공개 채팅의 m 이 presence 의 맵과 어긋날 수 있어(규칙이 거부) 보내지 않는다. 귓속말은 맵과 무관
    if (channel === 'near' && w.switching) { w.toast('맵을 옮기는 중이라 보내지 않았습니다. 잠시 후 다시 보내 주세요.', true); return; }
    if (text.length > CHAT_MAX_LEN) text = text.slice(0, CHAT_MAX_LEN);
    const base = { u: w.uid, n: w.profile.nick, ts: serverTimestamp() };
    const logKey = push(ref(db, 'logs/chat')).key!;
    const upd: Record<string, unknown> = {};

    if (channel === 'near' && this.isGhost()) {
      // 마피아 유령: 유령끼리만 보이는 채팅 (mafia/chat, 규칙이 죽은 참가자만 쓰게 한다)
      const key = push(ref(db, 'mafia/chat')).key!;
      upd[`mafia/chat/${key}`] = { ...base, t: text };
      upd[`logs/chat/${logKey}`] = { ...base, c: 'g', t: text };
      w.setBubble(w.uid, { text, kind: 'near', at: performance.now() });
    } else if (channel === 'near') {
      const key = push(ref(db, 'chat/public')).key!;
      upd[`chat/public/${key}`] = { ...base, t: text, c: channel, x: w.me.x, y: w.me.y, ...(w.mapId === MAIN_MAP_ID ? {} : { m: w.mapId }) }; // m: 규칙이 내 presence 의 맵과 대조 (없으면 기본 맵)
      upd[`logs/chat/${logKey}`] = { ...base, c: channel, t: text };
      upd[`users/${w.uid}/lastMsg`] = serverTimestamp();
      // 내 말풍선은 즉시 표시
      w.setBubble(w.uid, { text, kind: channel, at: performance.now() });
    } else {
      const toUid = await uidByNick(targetNick);
      if (!toUid) { w.toast(`'${targetNick}' 닉네임을 찾을 수 없습니다.`, true); return; }
      if (toUid === w.uid) { w.toast('자기 자신에게는 귓속말을 보낼 수 없습니다.', true); return; }
      if (!w.players.has(toUid)) { w.toast(`'${targetNick}' 님은 지금 접속 중이 아닙니다.`, true); return; }
      const toNick = w.nickOf(toUid);
      const key = push(ref(db, `chat/whisper/${toUid}`)).key!;
      upd[`chat/whisper/${toUid}/${key}`] = { f: w.uid, fn: w.profile.nick, t: text, ts: serverTimestamp(), x: w.me.x, y: w.me.y };
      upd[`logs/chat/${logKey}`] = { ...base, c: 'w', to: toUid, toNick, t: text };
      upd[`users/${w.uid}/lastMsg`] = serverTimestamp();
      w.events.emit('log', { channel: 'w', uid: w.uid, from: w.profile.nick, to: toNick, text, ts: serverNow(), self: true });
      w.setBubble(w.uid, { text, kind: 'w', at: performance.now() });
    }
    this.lastSent = now;
    try {
      await update(ref(db), upd);
    } catch (e) {
      console.warn('chat send failed', e);
      w.toast('메시지를 보내지 못했습니다.', true);
    }
  }

  // 마피아 유령 채팅: 유령일 때만 구독한다 (world 가 켜고 끈다)
  isGhost: () => boolean = () => false;
  private ghostUnsub: (() => void) | null = null;
  watchGhostChat(on: boolean): void {
    if (!on) { this.ghostUnsub?.(); this.ghostUnsub = null; return; }
    if (this.ghostUnsub) return;
    this.ghostUnsub = onNewChild('mafia/chat', serverNow() - 60000, 30, (s) => {
      const m = s.val() as GhostMsg;
      if (!m) return;
      this.w.events.emit('log', { channel: 'g', uid: m.u, from: m.n, text: m.t, ts: m.ts, self: m.u === this.w.uid });
      if (m.u !== this.w.uid) this.w.setBubble(m.u, { text: m.t, kind: 'near', at: performance.now() });
    });
  }
  systemMessage(text: string): void {
    this.w.events.emit('log', { channel: 'sys', from: '', text, ts: serverNow() });
  }

  // 가장 오래 접속한 사람이 오래된 공개 채팅을 정리 (2시간 이전, 최대 100개씩)
  private async maybeTrim(): Promise<void> {
    const w = this.w;
    let oldest = w.joinedAt, oldestUid = w.uid;
    for (const p of w.players.values()) if (p.st.j && p.st.j < oldest) { oldest = p.st.j; oldestUid = p.uid; }
    if (oldestUid !== w.uid) return;
    try {
      const cutoff = serverNow() - 2 * 60 * 60 * 1000;
      const q = query(ref(db, 'chat/public'), orderByChild('ts'), endAt(cutoff), limitToFirst(100));
      const s = await get(q);
      if (!s.exists()) return;
      const upd: Record<string, null> = {};
      s.forEach((c) => { upd[`chat/public/${c.key}`] = null; });
      await update(ref(db), upd);
    } catch { /* 권한/네트워크 오류는 무시 */ }
  }
}
