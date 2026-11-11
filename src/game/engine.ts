import { TILE } from '../shared/config';
import { clamp } from '../shared/util';

// 캔버스, 스케일, 카메라, 메인 루프
export class Engine {
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  scale = 2;
  w = 0;
  h = 0;
  cam = { x: 0, y: 0 }; // 월드 픽셀 기준 좌상단
  private raf = 0;
  private last = 0;
  private running = false;
  onResize: (() => void) | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    this.w = Math.max(1, Math.floor(rect?.width || window.innerWidth));
    this.h = Math.max(1, Math.floor(rect?.height || window.innerHeight));
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.scale = this.w >= 1000 ? 2 : this.w >= 600 ? 1.5 : 1.25;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.onResize?.();
  }

  // 월드 픽셀 좌표를 화면 중앙에 (맵 범위로 클램프)
  follow(wx: number, wy: number, mapW: number, mapH: number): void {
    const vw = this.w / this.scale, vh = this.h / this.scale;
    const mw = mapW * TILE, mh = mapH * TILE;
    let cx = wx - vw / 2, cy = wy - vh / 2;
    cx = mw <= vw ? (mw - vw) / 2 : clamp(cx, 0, mw - vw);
    cy = mh <= vh ? (mh - vh) / 2 : clamp(cy, 0, mh - vh);
    // 디바이스 픽셀 단위로 반올림 (흔들림 방지)
    const unit = 1 / (this.scale * this.dpr);
    this.cam.x = Math.round(cx / unit) * unit;
    this.cam.y = Math.round(cy / unit) * unit;
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cam.x) * this.scale, (wy - this.cam.y) * this.scale];
  }
  screenToWorld(sx: number, sy: number): [number, number] {
    return [sx / this.scale + this.cam.x, sy / this.scale + this.cam.y];
  }
  screenToTile(sx: number, sy: number): [number, number] {
    const [wx, wy] = this.screenToWorld(sx, sy);
    return [Math.floor(wx / TILE), Math.floor(wy / TILE)];
  }
  visibleTiles(mapW: number, mapH: number): { x0: number; y0: number; x1: number; y1: number } {
    const vw = this.w / this.scale, vh = this.h / this.scale;
    return {
      x0: clamp(Math.floor(this.cam.x / TILE) - 1, 0, mapW - 1),
      y0: clamp(Math.floor(this.cam.y / TILE) - 2, 0, mapH - 1),
      x1: clamp(Math.ceil((this.cam.x + vw) / TILE) + 1, 0, mapW - 1),
      y1: clamp(Math.ceil((this.cam.y + vh) / TILE) + 1, 0, mapH - 1),
    };
  }
  // 타일 좌표가 현재 화면 안에 있는지
  isTileVisible(tx: number, ty: number, margin = 0): boolean {
    const vw = this.w / this.scale, vh = this.h / this.scale;
    const wx = tx * TILE + TILE / 2, wy = ty * TILE + TILE / 2;
    return wx >= this.cam.x - margin && wx <= this.cam.x + vw + margin && wy >= this.cam.y - margin && wy <= this.cam.y + vh + margin;
  }

  // 월드 좌표계로 그리기 시작 (타일/스프라이트)
  beginWorld(): void {
    const s = this.scale * this.dpr;
    this.ctx.setTransform(s, 0, 0, s, -this.cam.x * s, -this.cam.y * s);
    this.ctx.imageSmoothingEnabled = false;
  }
  // 화면(CSS px) 좌표계로 그리기 (텍스트/말풍선)
  beginScreen(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }
  clear(color = '#1b2a1b'): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  start(frame: (dt: number, now: number) => void): void {
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = Math.min(100, t - this.last);
      this.last = t;
      frame(dt, t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
