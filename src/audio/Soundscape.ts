import type { PlanetType } from '../gen/system';
import { hash32, Rng } from '../gen/rng';

/** 지금 들려줄 장면. 음원 파일 없이 Web Audio로 그 자리에서 만든다. */
export type SoundScene =
  | { kind: 'galaxy' }
  | { kind: 'system'; temperatureK: number; civ: boolean; seed: number }
  | { kind: 'planet'; type: PlanetType; temperatureK: number; civ: boolean; seed: number }
  | { kind: 'hole'; core: boolean; seed: number }
  | { kind: 'warp' };

export type Chime = 'new' | 'life' | 'civ';

interface Layer {
  stop(at: number): void;
}

const CROSSFADE = 2.5;

function sceneKey(s: SoundScene): string {
  return s.kind === 'galaxy' || s.kind === 'warp' ? s.kind : `${s.kind}:${s.seed}`;
}

/** 별 온도(2,400~45,000K)를 0~1로. 소리의 높낮이와 밝기에 쓴다. */
function heat(temperatureK: number): number {
  return Math.min(1, Math.max(0, Math.log(temperatureK / 2400) / Math.log(45000 / 2400)));
}

/**
 * 우주 배경음. 기본은 꺼져 있고(자동 재생 금지), 사용자가 켰을 때만 AudioContext를 만든다.
 * 장면이 바뀌면 이전 층을 2.5초에 걸쳐 줄이고 새 층을 키운다.
 */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private pink!: AudioBuffer;
  private brown!: AudioBuffer;
  private layer: Layer | null = null;
  private key = '';
  private scene: SoundScene = { kind: 'galaxy' };
  private volume = 0.6;
  private enabled = false;
  /** 검수용: 실제로 소리가 나가는지 재는 분석기 */
  analyser: AnalyserNode | null = null;

  get on(): boolean {
    return this.enabled;
  }

  async enable(): Promise<void> {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    await ctx.resume();
    this.enabled = true;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.4);
    this.key = '';
    this.setScene(this.scene);
  }

  disable(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.enabled = false;
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    this.layer?.stop(ctx.currentTime + 0.8);
    this.layer = null;
    this.key = '';
    setTimeout(() => {
      if (!this.enabled) void ctx.suspend();
    }, 1000);
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.enabled) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
  }

  setScene(scene: SoundScene): void {
    this.scene = scene;
    const key = sceneKey(scene);
    if (!this.enabled || !this.ctx || key === this.key) return;
    this.key = key;
    this.layer?.stop(this.ctx.currentTime + CROSSFADE);
    this.layer = this.makeLayer(scene);
  }

  dispose(): void {
    this.enabled = false;
    this.layer = null;
    this.key = '';
    void this.ctx?.close();
    this.ctx = null;
  }

  // ── 짧은 소리 ──────────────────────────────────────────────────────────────
  /** 별을 고를 때: 뜨거운 별일수록 높은 음 */
  ping(temperatureK: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const f = 220 * Math.pow(2, heat(temperatureK) * 2.5);
    this.tone(f, ctx.currentTime, 0.9, 0.16, 'sine');
    this.tone(f * 1.5, ctx.currentTime + 0.02, 0.7, 0.05, 'sine');
  }

  /** 새로 찾은 곳: 생명·문명일수록 화음이 풍성해진다 */
  chime(kind: Chime): void {
    const ctx = this.ready();
    if (!ctx) return;
    const [root, steps] = kind === 'civ' ? [587, [1, 1.25, 1.5, 2]] : kind === 'life' ? [523, [1, 1.25, 1.5]] : [660, [1, 1.5]];
    steps.forEach((r, i) => this.tone(root * r, ctx.currentTime + i * 0.11, 1.4, 0.13, 'triangle'));
  }

  /** 워프: 바람 소리가 차오르다 잦아들고, 도착할 때 낮게 울린다 */
  warp(durationMs: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 1.3; // 목적지로 돌아보는 동안은 조용히
    const d = durationMs / 1000;
    const src = this.noiseSource(this.pink);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(160, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + d * 0.55);
    bp.frequency.exponentialRampToValueAtTime(260, t + d + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // 좁은 대역통과 필터를 지나면 잡음 에너지가 크게 줄어서 이득을 넉넉히 준다.
    g.gain.exponentialRampToValueAtTime(2.2, t + d * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
    src.connect(bp).connect(g).connect(this.bus);
    src.start(t, Math.random() * 2);
    src.stop(t + d + 0.8);

    const rise = ctx.createOscillator();
    rise.type = 'triangle';
    rise.frequency.setValueAtTime(70, t);
    rise.frequency.exponentialRampToValueAtTime(280, t + d * 0.6);
    rise.frequency.exponentialRampToValueAtTime(90, t + d);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.12, t + d * 0.5);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
    rise.connect(rg).connect(this.bus);
    rise.start(t);
    rise.stop(t + d + 0.4);

    // 도착 울림
    this.tone(55, t + d + 0.2, 3.5, 0.3, 'sine');
    this.tone(82.4, t + d + 0.25, 3, 0.14, 'sine');
  }

  // ── 내부 ──────────────────────────────────────────────────────────────────
  private ready(): AudioContext | null {
    return this.enabled && this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(comp).connect(this.analyser).connect(ctx.destination);

    // 모든 소리는 bus로 모여 원음과 잔향으로 나뉜다.
    this.bus = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 4.5, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    this.bus.connect(dry).connect(this.master);
    this.bus.connect(reverb).connect(wet).connect(this.master);

    this.pink = noiseBuffer(ctx, 'pink');
    this.brown = noiseBuffer(ctx, 'brown');
  }

  private noiseSource(buffer: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    return s;
  }

  private tone(freq: number, at: number, decay: number, level: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    o.connect(g).connect(this.bus);
    o.start(at);
    o.stop(at + decay + 0.05);
  }

  /** 장면 하나의 소리 층. 반환한 stop으로 서서히 끈다. */
  private makeLayer(scene: SoundScene): Layer {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.bus);
    const sources: AudioScheduledSourceNode[] = [];
    const timers: number[] = [];
    const rng = new Rng(scene.kind === 'galaxy' || scene.kind === 'warp' ? 7 : hash32(scene.seed, 5));

    const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const lfo = (rate: number, depth: number, param: AudioParam) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
      sources.push(o);
    };
    const osc = (type: OscillatorType, freq: number, level: number, dest: AudioNode, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(dest);
      o.start();
      sources.push(o);
      return g;
    };
    const noise = (buffer: AudioBuffer, level: number, dest: AudioNode) => {
      const s = this.noiseSource(buffer);
      const g = ctx.createGain();
      g.gain.value = level;
      s.connect(g).connect(dest);
      s.start(0, rng.range(0, 3));
      sources.push(s);
      return g;
    };
    /** 화음 패드: 음마다 좌우로 살짝 어긋난 두 오실레이터 → 천천히 여닫히는 저역 필터 */
    const pad = (root: number, ratios: number[], cutoff: number, level: number, type: OscillatorType = 'sine') => {
      const lp = filter('lowpass', cutoff, 0.5);
      lp.connect(out);
      lfo(rng.range(0.03, 0.07), cutoff * 0.35, lp.frequency);
      ratios.forEach((r, i) => {
        for (const d of [-7, 7]) osc(type, root * r, level / ratios.length, lp, d + i * 3);
      });
    };
    const shimmer = (freqs: number[], level: number) => {
      for (const f of freqs) {
        const g = osc('sine', f, level, out);
        lfo(rng.range(0.07, 0.2), level * 0.9, g.gain);
      }
    };
    const wind = (center: number, level: number) => {
      const bp = filter('bandpass', center, 1.6);
      lfo(rng.range(0.03, 0.08), center * 0.6, bp.frequency);
      bp.connect(out);
      const g = noise(this.pink, level, bp);
      lfo(rng.range(0.05, 0.12), level * 0.6, g.gain);
    };
    const waves = (level: number) => {
      const lp = filter('lowpass', 750, 0.4);
      lp.connect(out);
      const g = noise(this.pink, level, lp);
      lfo(rng.range(0.08, 0.13), level * 0.9, g.gain);
    };
    const rumble = (cutoff: number, level: number) => {
      const lp = filter('lowpass', cutoff, 0.6);
      lp.connect(out);
      const g = noise(this.brown, level, lp);
      lfo(rng.range(0.05, 0.09), level * 0.5, g.gain);
    };
    const crackle = () => {
      const bp = filter('bandpass', 3200, 1.2);
      bp.connect(out);
      timers.push(window.setInterval(() => {
        const t = ctx.currentTime;
        for (let k = 0; k < 3; k++) {
          if (Math.random() > 0.3) continue;
          const at = t + Math.random() * 0.1;
          const s = this.noiseSource(this.pink);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.12, at + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03 + Math.random() * 0.06);
          s.connect(g).connect(bp);
          s.start(at, Math.random() * 3);
          s.stop(at + 0.12);
        }
      }, 100));
    };
    /** 문명 신호: 별마다 정해진 길고 짧은 신호음을 몇 초마다 되풀이한다 */
    const beacon = (seed: number) => {
      const bits = new Rng(hash32(seed, 61));
      const pattern = Array.from({ length: bits.int(4, 7) }, () => (bits.chance(0.45) ? 0.24 : 0.08));
      const freq = bits.pick([988, 1046, 1175, 1318]);
      const play = () => {
        let at = ctx.currentTime + 0.05;
        for (const len of pattern) {
          const o = ctx.createOscillator();
          o.frequency.value = freq;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(0.035, at + 0.01);
          g.gain.setValueAtTime(0.035, at + len - 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, at + len);
          o.connect(g).connect(out);
          o.start(at);
          o.stop(at + len + 0.02);
          at += len + 0.09;
        }
      };
      play();
      timers.push(window.setInterval(play, 5200));
    };

    switch (scene.kind) {
      case 'galaxy':
        // 넓고 낮은 화음(라·미·라·시)과 아주 옅은 높은 반짝임
        pad(55, [1, 1.5, 2, 2.25], 520, 0.16);
        pad(110, [1, 1.5], 900, 0.035, 'triangle');
        shimmer([1760, 2637], 0.006);
        rumble(380, 0.05);
        break;
      case 'system': {
        // 별 온도가 높을수록 근음이 높고 필터가 밝다. 뜨거운 별은 장3도, 차가운 별은 단3도.
        const h = heat(scene.temperatureK);
        const root = 34 * Math.pow(2, h * 1.4);
        const third = h > 0.33 ? 1.25 : 1.2;
        pad(root, [1, 1.5, 2, third * 2], 280 + h * 1300, 0.17);
        const bp = filter('bandpass', root * 4, 9);
        bp.connect(out);
        osc('sawtooth', root * 2, 0.02, bp);
        if (h > 0.5) shimmer([root * 16, root * 24], 0.004);
        if (scene.civ) beacon(scene.seed);
        break;
      }
      case 'planet': {
        const h = heat(scene.temperatureK);
        const root = 34 * Math.pow(2, h * 1.4);
        switch (scene.type) {
          case 'gas':
          case 'icegiant':
            rumble(scene.type === 'gas' ? 140 : 220, 0.32);
            osc('sine', 31, 0.07, out);
            pad(root / 2, [1, 1.5, 2], 260, 0.12);
            break;
          case 'ocean':
            waves(0.06);
            pad(root, [1, 1.5, 2.5], 420, 0.1);
            break;
          case 'terran':
            waves(0.045);
            wind(520, 0.03);
            pad(root, [1, 1.25, 1.5, 2], 520, 0.11);
            break;
          case 'desert':
          case 'rocky':
            wind(420, 0.07);
            pad(root * 0.75, [1, 1.2, 1.5], 300, 0.1);
            break;
          case 'ice':
            shimmer([1318, 1760, 2093, 2637], 0.007);
            wind(900, 0.025);
            pad(root, [1, 1.5, 2.25], 700, 0.08);
            break;
          case 'lava':
            rumble(200, 0.24);
            crackle();
            pad(root * 0.75, [1, 1.2, 1.5], 240, 0.09);
            break;
        }
        if (scene.civ) beacon(scene.seed);
        break;
      }
      case 'hole': {
        // 아주 낮은 울림과, 천천히 여닫히는 거친 저음. 초대질량은 더 낮고 느리다.
        const root = scene.core ? 24 : 32;
        rumble(scene.core ? 90 : 130, 0.34);
        const lp = filter('lowpass', 160, 3);
        lfo(scene.core ? 0.025 : 0.06, 110, lp.frequency);
        lp.connect(out);
        osc('sawtooth', root, 0.05, lp, -5);
        osc('sawtooth', root * 1.5, 0.03, lp, 6);
        osc('sine', root / 2, 0.08, out);
        shimmer([root * 64, root * 96], 0.003);
        break;
      }
      case 'warp': {
        // 낮게 고동치는 엔진음
        const lp = filter('lowpass', 320, 1);
        const throb = ctx.createGain();
        throb.gain.value = 0.5;
        lfo(3.2, 0.45, throb.gain);
        throb.connect(lp).connect(out);
        osc('sawtooth', 55, 0.08, throb);
        osc('sawtooth', 55.6, 0.08, throb);
        break;
      }
    }

    const t = ctx.currentTime;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + CROSSFADE);

    return {
      stop: (at: number) => {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(0, at);
        timers.forEach((id) => clearInterval(id));
        for (const s of sources) {
          try {
            s.stop(at + 0.05);
          } catch {
            // 이미 멈춘 소스
          }
        }
        setTimeout(() => out.disconnect(), Math.max(0, at - now) * 1000 + 300);
      },
    };
  }
}

/** 잔향용 임펄스 응답: 시간이 갈수록 잦아드는 잡음 */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buf;
}

/** 분홍 잡음(Paul Kellet 근사)과 갈색 잡음(백색 잡음 적분) */
function noiseBuffer(ctx: BaseAudioContext, color: 'pink' | 'brown'): AudioBuffer {
  const length = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buf;
}
