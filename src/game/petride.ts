// 펫 레벨·탑승·상시 효과 (2026-11-10). 레벨은 지갑 px/{펫} (먹이 누적)에서 계산하고, 남들이 볼 수 있게 presence pl 에 같은 값을 싣는다 (규칙: 지갑 px 이하).
// 효과는 펫 종류와 상관없이 같다 (2026-11-10 밤 사용자 결정, Q 스킬 6종 삭제): 레벨마다 걷기 +2.5%, Lv5 달려도 벌레 안 도망, Lv8 갑옷처럼 100% 막고 80% 되받아침, Lv10 탑승 그림.
// 방어는 받는 쪽(나)이 판단하고(net.ts 밀치기·끌기, toss.ts 말랑이), 미는 쪽은 상대 presence pt·pl 로 미리 알고 건너뛴다 (shared/shop petGuardOf).
import { petCanRide, petRiding, petCalm, petGuard, petLevel, petSpeedMul, PET_CALM_LEVEL, PET_GUARD_LEVEL, PET_REFLECT_CHANCE } from '../shared/shop';
import { STEP_MS } from '../shared/config';
import type { Net } from './net';
import type { WorldCtx } from './state';

export class PetRide {
  private lastPl = -1;
  private lastPet: string | null = null;
  onChange: (() => void) | null = null; // 탑승 여부·펫이 바뀌면

  constructor(private w: WorldCtx, private net: Net) {}

  // 데리고 있는 펫 (가진 것일 때만)
  petId(): string | null { const pt = this.w.profile.eq?.pt; return pt && this.w.profile.own?.[pt] ? pt : null; }
  xp(): number { const id = this.petId(); return id ? this.w.wallet.petXp(id) : 0; }
  level(): number { return petLevel(this.xp()); }
  canRide(): boolean { return !!this.petId() && petCanRide(this.xp()); }
  riding(): boolean { return !!this.petId() && petRiding(this.xp(), this.w.profile.eq?.nr); }
  // 걷기 한 칸 시간 (달리기는 STEP_MS/2 그대로)
  walkMs(): number { return this.petId() ? Math.round(STEP_MS / petSpeedMul(this.xp())) : STEP_MS; }
  calm(): boolean { return !!this.petId() && petCalm(this.xp()); }
  guard(): boolean { return !!this.petId() && petGuard(this.xp()); }
  // 막은 것을 되받아칠지 (Lv8 이상일 때 80%)
  rollReflect(): boolean { return this.guard() && Math.random() < PET_REFLECT_CHANCE; }

  // presence pl 을 지갑 값과 맞춘다 (지갑·프로필이 바뀔 때마다 부른다). 단계가 바뀌면 알려 준다
  sync(): void {
    const id = this.petId();
    const xp = this.xp();
    const pl = id ? xp : 0;
    if (pl !== this.lastPl || id !== this.lastPet) {
      const first = this.lastPl < 0;
      const same = this.lastPet === id && this.lastPl >= 0;
      const prev = same ? this.lastPl : -1;
      this.lastPl = pl; this.lastPet = id;
      if (this.w.online) this.net.setPetXp(pl);
      if (id && !first && same) {
        if (!petCalm(prev) && petCalm(xp)) this.w.toast(`🐾 펫이 Lv${PET_CALM_LEVEL}! 채집 2칸, 달려도 벌레가 안 도망간다.`);
        if (!petGuard(prev) && petGuard(xp)) this.w.toast(`🛡 펫이 Lv${PET_GUARD_LEVEL}! 채집 3칸, 밀치기·말랑이·끌기를 막고 되받아친다.`);
        if (!petCanRide(prev) && petCanRide(xp)) this.w.toast('🏇 펫이 Lv10! 이제 타고 다닙니다. (내 메뉴나 상점에서 내려서 데리고 다닐 수도 있어요)');
      }
      this.onChange?.();
    }
  }
}
