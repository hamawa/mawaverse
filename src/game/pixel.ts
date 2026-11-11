// 아주 작은 픽셀 아트 그리기 도구. 캐릭터/타일을 코드로 그릴 때 사용.

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
export function shade(hex: string, amt: number): string {
  // amt < 0 어둡게, > 0 밝게 (비율)
  const [r, g, b] = hexToRgb(hex);
  if (amt < 0) { const k = 1 + amt; return rgbToHex(r * k, g * k, b * k); }
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a); const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export class PixelBuf {
  data: (string | null)[];
  constructor(public w: number, public h: number) {
    this.data = new Array<string | null>(w * h).fill(null);
  }
  clone(): PixelBuf { const b = new PixelBuf(this.w, this.h); b.data = this.data.slice(); return b; }
  get(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.data[y * this.w + x];
  }
  px(x: number, y: number, c: string | null): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string | null): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  hline(x: number, y: number, w: number, c: string): void { this.rect(x, y, w, 1, c); }
  vline(x: number, y: number, h: number, c: string): void { this.rect(x, y, 1, h, c); }
  circle(cx: number, cy: number, r: number, c: string): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r + r * 0.6) this.px(x, y, c);
      }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1 + 0.35 / Math.max(rx, ry)) this.px(x, y, c);
      }
  }
  // 둥근 사각형
  rrect(x: number, y: number, w: number, h: number, r: number, c: string): void {
    this.rect(x + r, y, w - 2 * r, h, c);
    this.rect(x, y + r, w, h - 2 * r, c);
    this.circle(x + r, y + r, r, c); this.circle(x + w - 1 - r, y + r, r, c);
    this.circle(x + r, y + h - 1 - r, r, c); this.circle(x + w - 1 - r, y + h - 1 - r, r, c);
  }
  blit(src: PixelBuf, dx: number, dy: number): void {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.data[y * src.w + x];
      if (c) this.px(dx + x, dy + y, c);
    }
  }
  mirrorX(): PixelBuf {
    const b = new PixelBuf(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) b.data[y * this.w + (this.w - 1 - x)] = this.data[y * this.w + x];
    return b;
  }
  shifted(dx: number, dy: number): PixelBuf {
    const b = new PixelBuf(this.w, this.h);
    b.blit(this, dx, dy);
    return b;
  }
  // 채워진 픽셀 주변(투명 픽셀)에 외곽선 추가
  outline(color: string): PixelBuf {
    const b = this.clone();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) b.data[y * this.w + x] = color;
    }
    return b;
  }
  // 오른쪽/아래가 비어 있는 픽셀을 살짝 어둡게 (간단한 입체감)
  autoShade(amount = -0.18, skip?: Set<string>): PixelBuf {
    const b = this.clone();
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.get(x, y);
      if (!c || (skip && skip.has(c))) continue;
      const below = this.get(x, y + 1);
      const right = this.get(x + 1, y);
      if (!below || (!right && y > 2)) b.data[y * this.w + x] = shade(c, amount);
    }
    return b;
  }
  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w; cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    for (let i = 0; i < this.data.length; i++) {
      const c = this.data[i];
      if (!c) continue;
      const [r, g, b] = hexToRgb(c);
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}
