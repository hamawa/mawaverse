import { el, escapeHtml, fmtDateTime } from '../shared/util';
import { modal, withCloseX, toast, confirmModal } from './ui';
import { loadPosts, createPost, deletePost, loadComments, addComment, deleteComment, BOARD_CATS, writableCats, catLabel, isBoardCat, POST_PAGE, TITLE_MAX, BODY_MAX, COMMENT_MAX, type PostRow } from './board';
import type { BoardCat } from '../shared/types';

export interface BoardUser { uid: string; nick: string; isAdmin: boolean }

const FILTER_KEY = 'mv-board-cat'; // 마지막으로 고른 필터 탭 (all | patch | promo | meet | junk)

function loadFilter(): BoardCat | null {
  try { const v = localStorage.getItem(FILTER_KEY); return isBoardCat(v) ? v : null; } catch { return null; }
}
function saveFilter(c: BoardCat | null): void {
  try { localStorage.setItem(FILTER_KEY, c ?? 'all'); } catch { /* ignore */ }
}

// [홍보] 같은 작은 분류 태그. 분류가 없는 옛 글은 null
function catTag(cat?: BoardCat): HTMLElement | null {
  return isBoardCat(cat) ? el('span', { class: 'cat ' + cat, text: catLabel(cat) }) : null;
}

export function openBoard(user: BoardUser, onClose?: () => void): void {
  const body = el('div', { class: 'board-body' });
  const m = modal('📌 마을 게시판', body, [], true);
  const origClose = m.close;
  m.close = () => { origClose(); onClose?.(); };
  m.root.querySelector('.actions')?.remove();
  m.root.classList.add('board');
  m.root.parentElement?.classList.add('board-bg');
  withCloseX(m);

  let filter: BoardCat | null = loadFilter();
  let rows: PostRow[] = [];
  let loadSeq = 0; // 탭을 빨리 바꿀 때 늦게 온 응답이 목록을 덮지 않게

  const itemOf = (r: PostRow): HTMLElement => {
    const title = el('span', { class: 'title' });
    const tag = catTag(r.post.cat);
    if (tag) title.append(tag);
    title.append(r.post.title + (r.post.cc ? ` [${r.post.cc}]` : ''));
    const item = el('div', { class: 'board-item' }, [title, el('span', { class: 'meta', text: `${r.post.n} · ${fmtDateTime(r.post.ts).slice(5, 16)}` })]);
    item.onclick = () => showPost(r);
    return item;
  };

  const showList = async () => {
    const seq = ++loadSeq;
    body.innerHTML = '';
    const bar = el('div', { class: 'row board-bar' });
    const write = el('button', { class: 'btn primary small', text: '✏ 글쓰기' });
    write.onclick = showWrite;
    const refresh = el('button', { class: 'btn small', text: '새로고침' });
    refresh.onclick = showList;
    bar.append(write, refresh);
    const tabs = el('div', { class: 'board-tabs' });
    for (const t of [{ id: null as BoardCat | null, label: '전체' }, ...BOARD_CATS]) {
      const b = el('button', { class: 'btn small' + (t.id === filter ? ' active' : ''), text: t.label });
      b.onclick = () => { filter = t.id; saveFilter(filter); showList(); };
      tabs.append(b);
    }
    const list = el('div', { class: 'board-list' });
    list.innerHTML = '<p class="muted">불러오는 중...</p>';
    body.append(bar, tabs, list);
    let got: PostRow[];
    try { got = await loadPosts(filter); } catch { if (seq === loadSeq) list.innerHTML = '<p class="error">게시글을 불러오지 못했습니다.</p>'; return; }
    if (seq !== loadSeq) return;
    rows = got;
    list.innerHTML = '';
    if (!rows.length) list.append(el('p', { class: 'muted', text: filter ? '이 분류에는 아직 글이 없습니다.' : '아직 글이 없습니다. 첫 글을 남겨보세요!' }));
    for (const r of rows) list.append(itemOf(r));
    if (rows.length >= POST_PAGE) {
      const more = el('button', { class: 'btn small board-more', text: '더 보기' });
      more.onclick = async () => {
        more.disabled = true;
        try {
          const older = await loadPosts(filter, rows[rows.length - 1].id);
          if (seq !== loadSeq) return;
          rows = rows.concat(older);
          for (const r of older) list.append(itemOf(r));
          if (older.length < POST_PAGE) more.remove();
        } catch { toast('더 불러오지 못했습니다.', true); }
        more.disabled = false;
      };
      body.append(more);
    }
  };

  const showWrite = () => {
    body.innerHTML = '';
    const view = el('div', { class: 'board-view' });
    const cats = writableCats(user.isAdmin); // 패치 노트는 관리자에게만 보인다
    let cat: BoardCat = filter && cats.some((c) => c.id === filter) ? filter : 'junk'; // 보고 있던 분류가 기본, 전체(또는 못 쓰는 분류)면 똥글
    const pick = el('div', { class: 'board-cats' });
    const paint = () => pick.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    for (const c of cats) {
      const b = el('button', { class: 'btn small', 'data-cat': c.id, text: c.label });
      b.onclick = () => { cat = c.id; paint(); };
      pick.append(b);
    }
    paint();
    const title = el('input', { type: 'text', placeholder: '제목', maxlength: String(TITLE_MAX) });
    const content = el('textarea', { placeholder: '내용', rows: '12', maxlength: String(BODY_MAX) });
    const err = el('div', { class: 'error' });
    const save = el('button', { class: 'btn primary', text: '등록' });
    const cancel = el('button', { class: 'btn', text: '취소' });
    save.onclick = async () => {
      save.disabled = true;
      try {
        await createPost(user.uid, user.nick, title.value, content.value, cat, user.isAdmin);
        toast('글을 등록했습니다.');
        if (filter && filter !== cat) { filter = cat; saveFilter(filter); } // 방금 쓴 글이 보이는 탭으로
        showList();
      } catch (e) { err.textContent = (e as Error).message; save.disabled = false; }
    };
    cancel.onclick = showList;
    [title, content].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
    view.append(
      el('div', { class: 'field' }, [el('label', { text: '분류' }), pick]),
      el('div', { class: 'field' }, [el('label', { text: '제목' }), title]),
      el('div', { class: 'field' }, [el('label', { text: '내용' }), content]),
      err, el('div', { class: 'actions' }, [cancel, save]));
    body.append(view);
    title.focus();
  };

  const showPost = async (r: PostRow) => {
    body.innerHTML = '';
    const view = el('div', { class: 'board-view' });
    const back = el('button', { class: 'btn small', text: '← 목록' });
    back.onclick = showList;
    const head = el('div', { class: 'row board-head' }, [back]);
    if (r.post.u === user.uid || user.isAdmin) {
      const del = el('button', { class: 'btn small danger', text: '삭제' });
      del.onclick = async () => { if (await confirmModal('이 글을 삭제할까요?')) { await deletePost(r.id); toast('삭제했습니다.'); showList(); } };
      head.append(del);
    }
    const h = el('h4', { style: 'margin:4px 0' });
    const tag = catTag(r.post.cat);
    if (tag) h.append(tag);
    h.append(r.post.title);
    view.append(head, h, el('div', { class: 'muted', text: `${r.post.n} · ${fmtDateTime(r.post.ts)}` }));
    view.append(el('div', { class: 'post-body', html: escapeHtml(r.post.body) }));
    const cbox = el('div');
    view.append(cbox);
    body.append(view);
    const renderComments = async () => {
      cbox.innerHTML = '';
      const cs = await loadComments(r.id).catch(() => []);
      cbox.append(el('div', { class: 'muted', text: `댓글 ${cs.length}` }));
      for (const c of cs) {
        const row = el('div', { class: 'comment' });
        row.append(el('div', { class: 'meta', text: `${c.c.n} · ${fmtDateTime(c.c.ts).slice(5, 16)}` }), el('div', { text: c.c.t }));
        if (c.c.u === user.uid || user.isAdmin || r.post.u === user.uid) {
          const d = el('button', { class: 'btn small', text: '삭제', style: 'float:right' });
          d.onclick = async () => { await deleteComment(r.id, c.id); renderComments(); };
          row.prepend(d);
        }
        cbox.append(row);
      }
      const input = el('input', { type: 'text', placeholder: '댓글 달기 (Enter)', maxlength: String(COMMENT_MAX), style: 'width:100%;margin-top:8px;background:#0d1510;color:#eef3ee;border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:8px' });
      input.addEventListener('keydown', async (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && input.value.trim()) {
          try { await addComment(r.id, user.uid, user.nick, input.value); input.value = ''; renderComments(); } catch (err) { toast((err as Error).message, true); }
        }
      });
      cbox.append(input);
    };
    renderComments();
  };

  showList();
}
