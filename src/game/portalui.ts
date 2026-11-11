import { modal, withCloseX } from './ui';
import { el } from '../shared/util';
import type { DestView } from './portal';

// 포탈 행선지 선택 창 (행선지가 2개 이상인 포탈에서 F). 항목을 누르거나 방향키로 고르고 Enter, Esc·닫기로 취소.
// onPick 은 창을 닫은 뒤에 불린다. onClose 는 고르든 취소하든 창이 닫힐 때 한 번
export function openPortalPicker(views: DestView[], onPick: (index: number) => void, onClose: () => void): { close: () => void } {
  let sel = Math.max(0, views.findIndex((v) => v.ok));
  const rows = views.map((v, i) => {
    const b = el('button', { class: 'portal-dest', type: 'button' }, [
      el('div', { class: 'pd-main' }, [
        el('div', { class: 'pd-name', text: v.name }),
        el('div', { class: 'pd-desc', text: v.ok ? v.desc : '지금 있는 곳' }),
      ]),
      el('div', { class: 'pd-count', text: `👥 ${v.count}명` }),
    ]);
    b.disabled = !v.ok;
    b.onclick = () => choose(i);
    b.onmouseenter = () => { if (v.ok) { sel = i; paint(); } };
    return b;
  });
  const paint = () => rows.forEach((b, i) => b.classList.toggle('on', i === sel && views[i].ok));
  const body = el('div', { class: 'portal-pick' }, [...rows, el('div', { class: 'muted pd-help', text: '방향키로 고르고 Enter · Esc 로 취소' })]);
  const move = (step: number) => {
    for (let n = 0, i = sel; n < views.length; n++) { i = (i + step + views.length) % views.length; if (views[i].ok) { sel = i; break; } }
    paint();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); move(1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(sel); }
  };
  const m = modal('🌀 어디로 갈까요?', body, [{ label: '취소', onClick: () => {} }], false, () => { document.removeEventListener('keydown', onKey, true); onClose(); });
  withCloseX(m);
  document.addEventListener('keydown', onKey, true);
  function choose(i: number): void {
    if (!views[i]?.ok) return;
    m.close();
    onPick(i);
  }
  paint();
  return { close: m.close };
}
