export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutCubic:(t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
} satisfies Record<string, Ease>;

interface Tween {
  elapsed: number;
  duration: number;
  ease: Ease;
  step: (k: number) => void;
  done: () => void;
}

/** 렌더 루프에서 dt를 받아 진행하는 아주 작은 트윈 관리자. 길이는 밀리초, dt는 초. */
export class Tweens {
  private list: Tween[] = [];

  run(duration: number, easing: Ease, step: (k: number) => void): Promise<void> {
    if (duration <= 0) {
      step(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.list.push({ elapsed: 0, duration, ease: easing, step, done: resolve });
    });
  }

  update(dt: number): void {
    if (this.list.length === 0) return;
    const finished: Tween[] = [];
    for (const t of this.list) {
      t.elapsed += dt * 1000;
      const k = Math.min(t.elapsed / t.duration, 1);
      t.step(t.ease(k));
      if (k >= 1) finished.push(t);
    }
    if (finished.length) {
      this.list = this.list.filter((t) => !finished.includes(t));
      finished.forEach((t) => t.done());
    }
  }

  get busy(): boolean {
    return this.list.length > 0;
  }
}
