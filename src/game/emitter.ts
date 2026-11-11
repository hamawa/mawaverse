// 아주 작은 이벤트 이미터
type AnyFn = (...a: unknown[]) => void;

export class Emitter<E extends Record<string, unknown[]>> {
  private m = new Map<keyof E, Set<AnyFn>>();
  on<K extends keyof E>(k: K, f: (...a: E[K]) => void): () => void {
    if (!this.m.has(k)) this.m.set(k, new Set());
    const fn = f as unknown as AnyFn;
    this.m.get(k)!.add(fn);
    return () => { this.m.get(k)?.delete(fn); };
  }
  emit<K extends keyof E>(k: K, ...a: E[K]): void {
    this.m.get(k)?.forEach((f) => { try { f(...(a as unknown[])); } catch (e) { console.error(e); } });
  }
}
