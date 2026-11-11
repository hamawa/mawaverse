import { ref, push, update, get, query, orderByKey, orderByChild, equalTo, startAt, limitToLast, endBefore, serverTimestamp, increment } from 'firebase/database';
import { db } from '../firebase/app';
import type { Post, Comment, BoardCat } from '../shared/types';

export const POST_PAGE = 20;
export const TITLE_MAX = 60;
export const BODY_MAX = 2000;
export const COMMENT_MAX = 300;

export interface PostRow { id: string; post: Post }

// 글 분류. 글쓰기 때 고르고 이후 바꿀 수 없다. 분류가 없는 옛 글은 '전체' 탭에서만 보인다.
export const BOARD_CATS: { id: BoardCat; label: string }[] = [
  { id: 'promo', label: '홍보' },
  { id: 'meet', label: '벙개' },
  { id: 'junk', label: '똥글' },
];
export const isBoardCat = (v: unknown): v is BoardCat => BOARD_CATS.some((c) => c.id === v);
export const catLabel = (c?: BoardCat): string => BOARD_CATS.find((x) => x.id === c)?.label ?? '';

// cat 이 null 이면 전체(키 순), 아니면 그 분류만 (cat 인덱스 + 키 순). beforeKey 보다 오래된 글부터 POST_PAGE 개
export async function loadPosts(cat: BoardCat | null, beforeKey?: string): Promise<PostRow[]> {
  const base = ref(db, 'board/posts');
  const q = cat
    ? (beforeKey
      ? query(base, orderByChild('cat'), startAt(cat), endBefore(cat, beforeKey), limitToLast(POST_PAGE))
      : query(base, orderByChild('cat'), equalTo(cat), limitToLast(POST_PAGE)))
    : (beforeKey
      ? query(base, orderByKey(), endBefore(beforeKey), limitToLast(POST_PAGE))
      : query(base, orderByKey(), limitToLast(POST_PAGE)));
  const s = await get(q);
  const rows: PostRow[] = [];
  s.forEach((c) => { rows.push({ id: c.key!, post: c.val() as Post }); });
  return rows.reverse();
}

export async function createPost(uid: string, nick: string, title: string, body: string, cat: BoardCat): Promise<void> {
  const t = title.trim().slice(0, TITLE_MAX);
  const b = body.trim().slice(0, BODY_MAX);
  if (!isBoardCat(cat)) throw new Error('분류를 고르세요.');
  if (!t) throw new Error('제목을 입력하세요.');
  if (!b) throw new Error('내용을 입력하세요.');
  const key = push(ref(db, 'board/posts')).key!;
  await update(ref(db), { [`board/posts/${key}`]: { title: t, body: b, u: uid, n: nick, ts: serverTimestamp(), cc: 0, cat } });
}

export async function deletePost(id: string): Promise<void> {
  await update(ref(db), { [`board/posts/${id}`]: null, [`board/comments/${id}`]: null });
}

export async function loadComments(postId: string): Promise<{ id: string; c: Comment }[]> {
  const s = await get(query(ref(db, `board/comments/${postId}`), orderByKey()));
  const rows: { id: string; c: Comment }[] = [];
  s.forEach((c) => { rows.push({ id: c.key!, c: c.val() as Comment }); });
  return rows;
}

export async function addComment(postId: string, uid: string, nick: string, text: string): Promise<void> {
  const t = text.trim().slice(0, COMMENT_MAX);
  if (!t) throw new Error('댓글 내용을 입력하세요.');
  const key = push(ref(db, `board/comments/${postId}`)).key!;
  await update(ref(db), { [`board/comments/${postId}/${key}`]: { u: uid, n: nick, t, ts: serverTimestamp() }, [`board/posts/${postId}/cc`]: increment(1) });
}

export async function deleteComment(postId: string, cid: string): Promise<void> {
  await update(ref(db), { [`board/comments/${postId}/${cid}`]: null, [`board/posts/${postId}/cc`]: increment(-1) });
}
