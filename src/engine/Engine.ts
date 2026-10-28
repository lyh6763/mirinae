import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GradeShader } from './shaders/grade';
import { CORE_INDEX, generateGalaxy, LY_PER_UNIT, SPECTRAL_CLASSES, type Galaxy, type SpectralClass } from '../gen/galaxy';
import { StarGrid } from '../gen/neighbors';
import { makeStar, makeSystem, type LifeLevel, type StarSystem } from '../gen/system';
import { LabelLayer } from './labels';
import { ease, Tweens, type Ease } from './tween';
import { GalaxyView } from './views/GalaxyView';
import { PlanetView } from './views/PlanetView';
import { SystemView } from './views/SystemView';
import { WarpView } from './views/WarpView';
import { BlackHoleView } from './views/BlackHoleView';
import { FlightView, type FlightTelemetry } from './views/FlightView';
import type { CameraPose, View, ViewContext } from './views/view';

export type Mode = 'galaxy' | 'system' | 'planet';

export interface Signal {
  star: number;
  starName: string;
  planet: number;
  planetName: string;
  signal: string;
}

export interface ScanState {
  done: number;
  total: number;
  planets: number;
  living: number;
  signals: Signal[];
  binaries: number;
  /** 블랙홀 목록. 0번(은하 중심)이 맨 앞 */
  holes: { star: number; name: string }[];
}

export interface WarpInfo {
  from: number;
  to: number;
  fromName: string;
  name: string;
  distanceLy: number;
  durationMs: number;
  /** 0~1 */
  progress: number;
}

export interface NeighborInfo {
  index: number;
  name: string;
  cls: SpectralClass;
  color: string;
  distanceLy: number;
  planets: number;
  /** 그 계에서 가장 높은 생명 단계 */
  life: LifeLevel;
}

export interface EngineState {
  mode: Mode;
  galaxyName: string;
  starCount: number;
  arms: number;
  selectedStar: number | null;
  /** 은하 화면에서는 고른 별의 미리보기, 항성계·행성 화면에서는 지금 들어와 있는 계 */
  system: StarSystem | null;
  selectedPlanet: number | null;
  busy: boolean;
  scan: ScanState;
  /** 별 사이를 나는 중이면 그 정보 */
  warp: WarpInfo | null;
  /** 행성 표면 위를 나는 중 */
  flight: boolean;
}

export interface FlightOptions {
  auto: boolean;
  speed: number;
  clearance: number;
}

export interface SearchHit {
  index: number;
  name: string;
  cls: SpectralClass;
}

/** 사진 모드 설정. 값이 1이면 그대로, 0이면 효과 없음. */
export interface PhotoSettings {
  exposure: number;
  bloom: number;
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  mono: number;
  vignette: number;
  grain: number;
  /** 궤도 운동·자전·구름을 멈춘다 */
  freeze: boolean;
  /** 이름표·궤도선·선택 표지를 보인다 */
  guides: boolean;
}

export type PhotoFrame = 'none' | 'postcard' | 'log';

export interface CaptureOptions {
  /** 가로/세로. null이면 화면 그대로 */
  aspect: number | null;
  frame: PhotoFrame;
  title: string;
  subtitle: string;
}

export interface RestoreTarget {
  star: number | null;
  planet: number | null;
  mode: Mode;
}

const EMPTY_SCAN: ScanState = { done: 0, total: 0, planets: 0, living: 0, signals: [], binaries: 0, holes: [] };

export class Engine {
  readonly canvas: HTMLCanvasElement;
  /** 그래픽 장치를 잃었을 때(절전 복귀·드라이버 재설정 등) 부른다. 화면은 새로고침으로만 되살린다. */
  onContextLost: (() => void) | null = null;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private gradePass: ShaderPass;
  private photo: PhotoSettings | null = null;
  /** 시간 멈춤을 반영한 장면 시간 */
  private simTime = 0;
  private camera = new THREE.PerspectiveCamera(55, 1, 0.5, 40000);
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private raycaster = new THREE.Raycaster();
  private tweens = new Tweens();
  private labels: LabelLayer;
  private fadeEl: HTMLDivElement;
  private ctx: ViewContext;

  private galaxy!: Galaxy;
  private galaxyView!: GalaxyView;
  private systemView: SystemView | null = null;
  private holeView: BlackHoleView | null = null;
  private flightView: FlightView | null = null;
  private planetView: PlanetView | null = null;
  private view!: View;

  private state: EngineState;
  private listeners = new Set<() => void>();
  private names: string[] = [];
  private scanToken = 0;

  private width = 1;
  private height = 1;
  private insetRight = 0;
  private insetBottom = 0;
  private raf = 0;
  private tweening = false;
  private cameraMove = 0;
  private disposed = false;
  /** 첫 항성계 진입 때 멈칫하지 않도록 셰이더를 미리 컴파일해 둔 장면. 프로그램이 풀리지 않게 은하가 바뀔 때까지 둔다. */
  private warm: SystemView | null = null;
  private warmHole: BlackHoleView | null = null;
  private grid: StarGrid | null = null;
  private follow: (() => THREE.Vector3) | null = null;
  private galaxySnapshot: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private systemSnapshot: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

  private pointer = new THREE.Vector2();
  private pointerInside = false;
  private hoverDirty = false;
  private lastHover = 0;
  private hovered = -1;
  private down: { x: number; y: number; t: number } | null = null;
  private lastDrag: { x: number; y: number } | null = null;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement, galaxyName: string, private reducedMotion: boolean) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'stage__canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-roledescription', '우주 지도');
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    container.appendChild(this.canvas);

    this.labels = new LabelLayer(container);
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'stage__fade';
    container.appendChild(this.fadeEl);
    this.ctx = { pixelRatio, labels: this.labels, reducedMotion };

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.6;

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(pixelRatio);
    this.renderPass = new RenderPass(new THREE.Scene(), this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.6, 0.2);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.gradePass = new ShaderPass(GradeShader);
    this.gradePass.enabled = false;
    this.composer.addPass(this.gradePass);

    this.state = {
      mode: 'galaxy', galaxyName, starCount: 0, arms: 0,
      selectedStar: null, system: null, selectedPlanet: null, busy: false, scan: EMPTY_SCAN, warp: null, flight: false,
    };
    this.loadGalaxy(galaxyName);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindPointer();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ── 상태 구독 (React useSyncExternalStore용) ──────────────────────────────
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): EngineState => this.state;

  private setState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  // ── 은하 ─────────────────────────────────────────────────────────────────
  private loadGalaxy(name: string): void {
    this.warm?.dispose();
    this.warm = null;
    this.warmHole?.dispose();
    this.warmHole = null;
    this.grid = null;
    this.galaxy = generateGalaxy(name);
    this.galaxyView = new GalaxyView(this.galaxy, this.ctx);
    this.setView(this.galaxyView);
    this.applyPose(this.galaxyView.home());
    this.names = [];
    this.setState({
      mode: 'galaxy', galaxyName: name, starCount: this.galaxy.count, arms: this.galaxy.shape.arms,
      selectedStar: null, system: null, selectedPlanet: null, scan: { ...EMPTY_SCAN, total: this.galaxy.count },
    });
    this.startScan();
    setTimeout(() => void this.warmUp(this.galaxy), 900);
  }

  /** 렌더 타깃 설정을 실제 그릴 때(합성기 버퍼)와 맞춰야 같은 프로그램으로 컴파일된다. */
  private precompile(scene: THREE.Scene): Promise<unknown> {
    this.renderer.setRenderTarget(this.composer.readBuffer);
    const done = this.renderer.compileAsync(scene, this.camera);
    this.renderer.setRenderTarget(null);
    return done;
  }

  /**
   * 행성 셰이더는 처음 컴파일할 때 2초 남짓 걸린다. 은하를 보는 동안 고리·구름·대기가 다 있는 계 하나를
   * 만들어 병렬 컴파일해 두면, 처음 들어갈 때도 멈칫하지 않는다.
   */
  private async warmUp(galaxy: Galaxy): Promise<void> {
    if (this.disposed || galaxy !== this.galaxy) return;
    let pick = 0;
    for (let i = 0; i < Math.min(galaxy.count, 4000); i++) {
      const { planets } = makeSystem(galaxy, i);
      if (planets.some((p) => p.rings) && planets.some((p) => p.look.clouds > 0.02 && p.look.kind === 0)) {
        pick = i;
        break;
      }
    }
    const offstage = new LabelLayer(document.createElement('div'));
    this.warm = new SystemView(galaxy, makeSystem(galaxy, pick), { ...this.ctx, labels: offstage });
    await this.precompile(this.warm.scene);
    if (this.disposed || galaxy !== this.galaxy) return;
    this.grid ??= new StarGrid(galaxy);
    // 블랙홀 광선 추적 셰이더도 미리 컴파일한다(큐브맵은 실제로 들어갈 때 그린다).
    this.warmHole = new BlackHoleView(galaxy, makeSystem(galaxy, CORE_INDEX), this.ctx);
    await this.precompile(this.warmHole.scene);
  }

  /** index에서 가까운 별들. 이웃 별 목록과 워프 목적지에 쓴다. */
  neighbors(index: number, count = 6): NeighborInfo[] {
    this.grid ??= new StarGrid(this.galaxy);
    return this.grid.nearest(index, count).map(({ index: j, distance }) => {
      const { star, planets } = makeSystem(this.galaxy, j);
      return {
        index: j, name: star.name, cls: star.cls, color: star.color,
        distanceLy: Math.round(distance * LY_PER_UNIT),
        planets: planets.length,
        life: planets.reduce<LifeLevel>((m, p) => (p.life > m ? p.life : m), 0),
      };
    });
  }

  /**
   * 지금 있는 항성계에서 다른 별로 곧장 날아간다. 은하 화면을 거치지 않는다.
   * 목적지 쪽으로 돌아보기 → 워프(가속·순항·감속) → 새 항성계 도착.
   */
  async warpTo(index: number): Promise<void> {
    const from = this.state.selectedStar;
    if ((!this.systemView && !this.holeView) || from === null || index === from || this.state.busy || this.state.mode !== 'system') return;
    const quick = this.reducedMotion;
    const target = makeSystem(this.galaxy, index);
    const a = this.galaxyView.starPosition(from);
    const b = this.galaxyView.starPosition(index);
    const dir = b.clone().sub(a).normalize();
    const distanceLy = Math.round(a.distanceTo(b) * LY_PER_UNIT);
    const durationMs = quick ? 0 : Math.round(2800 + Math.min(distanceLy / 3000, 1) * 1800);
    this.setState({
      busy: true,
      warp: { from, to: index, fromName: this.state.system?.star.name ?? '', name: target.star.name, distanceLy, durationMs, progress: 0 },
    });
    this.clearHover();
    this.follow = null;
    this.systemView?.setSelected(null);
    this.controls.enabled = false;

    if (!quick) {
      // 항성계 하늘의 방향은 은하 좌표의 방향과 같으므로, 그 방향을 보면 목적지 별이 화면 가운데 온다.
      // 목적지가 등 뒤일 수도 있어 시선 목표점을 직선으로 옮기지 않고 회전을 보간한다.
      const eye = this.camera.position.clone();
      const q0 = this.camera.quaternion.clone();
      const q1 = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(eye, eye.clone().add(dir), this.camera.up),
      );
      const f0 = this.camera.fov;
      await this.moveCamera(1400, ease.inOutCubic, (k) => {
        this.camera.quaternion.slerpQuaternions(q0, q1, k);
        this.camera.fov = f0 + (58 - f0) * k;
        this.camera.updateProjectionMatrix();
      });
      this.controls.target.copy(eye).addScaledVector(dir, 40);
    }
    await this.fade(1, quick ? 120 : 220);
    this.disposeSubViews();

    let warp: WarpView | null = null;
    if (!quick) {
      warp = new WarpView(this.galaxy, from, index, this.ctx);
      await this.precompile(warp.scene);
      this.setView(warp);
      this.labels.root.hidden = true;
      this.applyPose(warp.home());
      void this.fade(0, 260);
      let lastEmit = 0;
      await this.tweens.run(durationMs, ease.inOutSine, (k) => {
        warp!.setProgress(k);
        const now = performance.now();
        if (this.state.warp && (now - lastEmit > 100 || k >= 1)) {
          lastEmit = now;
          this.setState({ warp: { ...this.state.warp, progress: k } });
        }
      });
      await this.fade(1, 260);
    }

    // 도착: 은하로 돌아갈 때도 새 별 근처로 가도록 시점 기록을 옮긴다.
    this.galaxyView.setSelected(index);
    if (this.galaxySnapshot) {
      const offset = this.galaxySnapshot.position.clone().sub(this.galaxySnapshot.target);
      this.galaxySnapshot = { position: b.clone().add(offset), target: b.clone() };
    }
    const stage = await this.openStage(target);
    warp?.dispose();
    this.labels.root.hidden = false;
    this.controls.enabled = true;
    const home = stage.home();
    this.setState({ mode: 'system', selectedStar: index, system: target, selectedPlanet: null, warp: null });
    if (quick) {
      this.applyPose(home);
      await this.fade(0, 160);
    } else {
      this.applyPose({ ...home, position: home.position.clone().multiplyScalar(0.25) });
      const fadeIn = this.fade(0, 450);
      await this.flyTo(home.position, home.target, home.fov, 1700, ease.outQuint);
      await fadeIn;
    }
    this.setState({ busy: false });
  }

  async setGalaxy(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || this.state.busy || trimmed === this.state.galaxyName) return;
    this.setState({ busy: true });
    await this.fade(1, this.reducedMotion ? 120 : 350);
    this.disposeSubViews();
    this.galaxyView.dispose();
    this.follow = null;
    this.loadGalaxy(trimmed);
    await this.fade(0, this.reducedMotion ? 120 : 700);
    this.setState({ busy: false });
  }

  /** 은하의 모든 계를 조금씩 만들어 보며 행성·생명·문명 신호를 센다. 렌더링을 막지 않게 7ms씩 끊는다. */
  private startScan(): void {
    const token = ++this.scanToken;
    const galaxy = this.galaxy;
    const names: string[] = new Array(galaxy.count);
    const signals: Signal[] = [];
    let i = 0;
    let planets = 0;
    let living = 0;
    let binaries = 0;
    const holes: { star: number; name: string }[] = [];
    let lastEmit = 0;

    const step = () => {
      if (token !== this.scanToken) return;
      const start = performance.now();
      const found: number[] = [];
      while (i < galaxy.count) {
        const sys = makeSystem(galaxy, i);
        names[i] = sys.star.name;
        planets += sys.planets.length;
        if (sys.star.kind === 'binary') binaries++;
        else if (sys.star.hole) holes.push({ star: i, name: sys.star.name });
        for (const p of sys.planets) {
          if (p.life > 0) living++;
          if (p.life === 3) {
            signals.push({ star: i, starName: sys.star.name, planet: p.order, planetName: p.name, signal: p.civSignal ?? '' });
            found.push(i);
          }
        }
        i++;
        if ((i & 63) === 0 && performance.now() - start > 7) break;
      }
      this.names = names;
      if (found.length) this.galaxyView.addSignals(found);
      const now = performance.now();
      if (now - lastEmit > 120 || i >= galaxy.count) {
        lastEmit = now;
        this.setState({
          scan: { done: i, total: galaxy.count, planets, living, signals: signals.slice(), binaries, holes: holes.slice() },
        });
      }
      if (i < galaxy.count) setTimeout(step, 0);
    };
    setTimeout(step, 400);
  }

  search(query: string, limit = 8): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    const starts: SearchHit[] = [];
    const contains: SearchHit[] = [];
    for (let i = 0; i < this.names.length && starts.length < limit; i++) {
      const name = this.names[i];
      if (!name) continue;
      if (name.startsWith(q)) starts.push(this.hit(i));
      else if (contains.length < limit && name.includes(q)) contains.push(this.hit(i));
    }
    return [...starts, ...contains].slice(0, limit);
  }

  private hit(index: number): SearchHit {
    return { index, name: this.names[index], cls: SPECTRAL_CLASSES[this.galaxy.classes[index]] };
  }

  randomStar(): void {
    for (let tries = 0; tries < 40; tries++) {
      const index = Math.floor(Math.random() * this.galaxy.count);
      if (makeSystem(this.galaxy, index).planets.length >= 2) {
        this.selectStar(index);
        return;
      }
    }
  }

  selectStar(index: number | null, focus = true): void {
    if (this.state.busy) return;
    if (this.state.mode !== 'galaxy') return;
    this.galaxyView.setSelected(index);
    if (index === null) {
      this.setState({ selectedStar: null, system: null, selectedPlanet: null });
      return;
    }
    this.setState({ selectedStar: index, system: makeSystem(this.galaxy, index), selectedPlanet: null });
    if (focus) void this.focusStar(index);
  }

  /** 고른 별로 시선을 옮긴다. 너무 멀리 있으면 조금 다가간다. */
  private focusStar(index: number): Promise<void> {
    const target = this.galaxyView.starPosition(index);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = offset.length();
    if (dist > 320) offset.setLength(240);
    return this.flyTo(target.clone().add(offset), target, this.camera.fov, this.reducedMotion ? 0 : 1100, ease.outCubic);
  }

  // ── 항성계 ───────────────────────────────────────────────────────────────
  async enterSystem(index = this.state.selectedStar, instant = false): Promise<void> {
    if (index === null || this.state.busy || this.state.mode !== 'galaxy') return;
    if (this.state.selectedStar !== index) this.selectStar(index, false);
    const quick = instant || this.reducedMotion;
    this.setState({ busy: true });
    this.clearHover();
    this.galaxySnapshot = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    const starPos = this.galaxyView.starPosition(index);
    if (!quick) {
      const dir = this.camera.position.clone().sub(starPos).normalize();
      await this.flyTo(starPos.clone().addScaledVector(dir, 1.2), starPos, 78, 1500, ease.inOutCubic);
    }
    // instant는 화면 가림을 부른 쪽(처음 열기·좌표 이동)에 맡긴다.
    if (!instant) await this.fade(1, quick ? 120 : 260);

    const system = this.state.system ?? makeSystem(this.galaxy, index);
    const stage = await this.openStage(system);
    const home = stage.home();
    this.setState({ mode: 'system', system, selectedPlanet: null });
    if (quick) {
      this.applyPose(home);
      if (!instant) await this.fade(0, 160);
    } else {
      this.applyPose({ ...home, position: home.position.clone().multiplyScalar(0.1) });
      const fadeIn = this.fade(0, 500);
      await this.flyTo(home.position, home.target, home.fov, 1900, ease.outQuint);
      await fadeIn;
    }
    this.setState({ busy: false });
  }

  /** 별 종류에 맞는 화면(항성계 또는 블랙홀)을 만들어 미리 컴파일한 뒤 띄운다. */
  private async openStage(system: StarSystem): Promise<View> {
    let stage: SystemView | BlackHoleView;
    if (system.star.hole) {
      this.holeView = new BlackHoleView(this.galaxy, system, this.ctx);
      this.holeView.prepare(this.renderer);
      stage = this.holeView;
    } else {
      this.systemView = new SystemView(this.galaxy, system, this.ctx);
      stage = this.systemView;
    }
    await this.precompile(stage.scene);
    this.setView(stage);
    return stage;
  }

  private async exitSystem(): Promise<void> {
    if (!this.systemView && !this.holeView) return;
    const quick = this.reducedMotion;
    this.setState({ busy: true });
    this.follow = null;
    await this.fade(1, quick ? 120 : 300);
    this.disposeSubViews();
    this.setView(this.galaxyView);
    const index = this.state.selectedStar!;
    const starPos = this.galaxyView.starPosition(index);
    const snap = this.galaxySnapshot ?? { position: starPos.clone().add(new THREE.Vector3(0, 120, 200)), target: starPos };
    const home = this.galaxyView.home();
    this.setState({ mode: 'galaxy', selectedPlanet: null, system: makeSystem(this.galaxy, index) });
    if (quick) {
      this.applyPose({ ...home, position: snap.position, target: snap.target });
      await this.fade(0, 120);
    } else {
      const dir = snap.position.clone().sub(starPos).normalize();
      this.applyPose({ ...home, position: starPos.clone().addScaledVector(dir, 1.5), target: starPos, fov: 78 });
      const fadeIn = this.fade(0, 450);
      await this.flyTo(snap.position, snap.target, home.fov, 1600, ease.outCubic);
      await fadeIn;
    }
    this.setState({ busy: false });
  }

  selectPlanet(index: number | null): void {
    const sv = this.systemView;
    if (!sv || this.state.busy || this.state.mode !== 'system') return;
    sv.setSelected(index);
    this.setState({ selectedPlanet: index });
    if (index === null) {
      this.follow = null;
      return;
    }
    const size = sv.planetSize(index);
    const from = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    const fromOffset = from.pos.clone().sub(from.target);
    const toOffset = fromOffset.clone().setLength(THREE.MathUtils.clamp(fromOffset.length(), size * 8, size * 8 + 14));
    const now = new THREE.Vector3();
    this.follow = null;
    const done = () => (this.follow = () => sv.planetPosition(index, now));
    if (this.reducedMotion) {
      this.applyPose({ ...this.poseNow(), position: sv.planetPosition(index, now).clone().add(toOffset), target: now.clone() });
      done();
      return;
    }
    void this.moveCamera(1100, ease.outCubic, (k) => {
      sv.planetPosition(index, now);
      this.controls.target.lerpVectors(from.target, now, k);
      this.camera.position.copy(this.controls.target).add(fromOffset.clone().lerp(toOffset, k));
    }).then((finished) => {
      if (finished) done();
    });
  }

  // ── 행성 ─────────────────────────────────────────────────────────────────
  async enterPlanet(index = this.state.selectedPlanet, instant = false): Promise<void> {
    const sv = this.systemView;
    if (!sv || index === null || this.state.busy || this.state.mode !== 'system') return;
    if (this.state.selectedPlanet !== index) {
      sv.setSelected(index);
      this.setState({ selectedPlanet: index });
    }
    const quick = instant || this.reducedMotion;
    this.setState({ busy: true });
    this.clearHover();
    this.follow = null;
    sv.frozen = true;
    const pp = sv.planetPosition(index);
    this.systemSnapshot = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    if (!quick) {
      const dir = this.camera.position.clone().sub(pp).normalize();
      await this.flyTo(pp.clone().addScaledVector(dir, sv.planetSize(index) * 2.4), pp, 46, 1300, ease.inOutCubic);
    }
    if (!instant) await this.fade(1, quick ? 120 : 240);

    this.planetView = new PlanetView(this.galaxy, sv.system, index, this.ctx);
    await this.precompile(this.planetView.scene);
    this.setView(this.planetView);
    this.labels.root.hidden = true;
    const home = this.planetView.home();
    this.setState({ mode: 'planet' });
    if (quick) {
      this.applyPose(home);
      if (!instant) await this.fade(0, 160);
    } else {
      this.applyPose({ ...home, position: home.position.clone().multiplyScalar(2.6) });
      const fadeIn = this.fade(0, 500);
      await this.flyTo(home.position, home.target, home.fov, 1700, ease.outQuint);
      await fadeIn;
    }
    this.setState({ busy: false });
  }

  private async exitPlanet(): Promise<void> {
    const sv = this.systemView;
    if (!sv || !this.planetView) return;
    const quick = this.reducedMotion;
    const index = this.state.selectedPlanet!;
    this.setState({ busy: true });
    await this.fade(1, quick ? 120 : 280);
    this.endFlightNow();
    this.planetView.dispose();
    this.planetView = null;
    this.setView(sv);
    this.labels.root.hidden = false;
    const home = sv.home();
    const pp = sv.planetPosition(index);
    // 들어가기 전 시점의 각도와 거리는 살리되, 중심은 지금 보던 행성으로 맞춘다(다른 행성으로 옮겨 다녔을 수 있다).
    const snap = this.systemSnapshot ?? { position: home.position, target: home.target };
    const backPos = pp.clone().add(snap.position.clone().sub(snap.target));
    this.setState({ mode: 'system' });
    if (quick) {
      this.applyPose({ ...home, position: backPos, target: pp });
      await this.fade(0, 120);
    } else {
      const dir = backPos.clone().sub(pp).normalize();
      this.applyPose({ ...home, position: pp.clone().addScaledVector(dir, sv.planetSize(index) * 2.6), target: pp, fov: 46 });
      const fadeIn = this.fade(0, 450);
      await this.flyTo(backPos, pp, home.fov, 1400, ease.outCubic);
      await fadeIn;
    }
    sv.frozen = false;
    this.follow = () => sv.planetPosition(index);
    this.setState({ busy: false });
  }

  // ── 저공비행 ─────────────────────────────────────────────────────────────────
  /** 지금 보던 지점 아래로 내려가 표면 위를 난다. 가스 행성은 땅이 없어 못 한다. */
  async startFlight(): Promise<void> {
    const pv = this.planetView;
    if (!pv || !pv.canFly || this.flightView || this.state.busy || this.state.mode !== 'planet') return;
    const quick = this.reducedMotion;
    this.setState({ busy: true });
    const start = pv.localDirection(this.camera.position);
    const suns = pv.sunsLocal();
    if (!quick) {
      await this.flyTo(this.camera.position.clone().setLength(1.1), new THREE.Vector3(), 64, 1500, ease.inOutCubic);
    }
    await this.fade(1, quick ? 120 : 300);
    this.flightView = new FlightView(this.galaxy, pv.system, pv.index, start, suns, this.ctx);
    await this.precompile(this.flightView.scene);
    this.setView(this.flightView);
    this.controls.enabled = false;
    this.applyPose(this.flightView.home());
    this.setState({ flight: true });
    await this.fade(0, quick ? 120 : 800);
    this.setState({ busy: false });
  }

  async stopFlight(): Promise<void> {
    const pv = this.planetView;
    if (!this.flightView || !pv || this.state.busy) return;
    const quick = this.reducedMotion;
    this.setState({ busy: true });
    await this.fade(1, quick ? 120 : 300);
    this.endFlightNow();
    this.setView(pv);
    const home = pv.home();
    this.applyPose(quick ? home : { ...home, position: home.position.clone().setLength(1.4) });
    const fadeIn = this.fade(0, quick ? 120 : 500);
    if (!quick) await this.flyTo(home.position, home.target, home.fov, 1500, ease.outCubic);
    await fadeIn;
    this.setState({ busy: false });
  }

  /** 화면을 가린 상태에서 비행을 곧바로 정리한다. */
  private endFlightNow(): void {
    if (!this.flightView) return;
    this.flightView.dispose();
    this.flightView = null;
    this.camera.up.set(0, 1, 0);
    this.controls.enabled = true;
    this.setState({ flight: false });
  }

  setFlightOptions(options: Partial<FlightOptions>): void {
    if (!this.flightView) return;
    Object.assign(this.flightView, options);
  }

  flightTelemetry(): FlightTelemetry | null {
    return this.flightView?.getTelemetry() ?? null;
  }

  /** 행성 화면에서 같은 계의 다른 행성으로 옮겨 간다. */
  async switchPlanet(index: number): Promise<void> {
    const sv = this.systemView;
    if (!sv || !this.planetView || this.flightView || this.state.busy || this.state.mode !== 'planet') return;
    if (index < 0 || index >= sv.system.planets.length || index === this.state.selectedPlanet) return;
    const quick = this.reducedMotion;
    this.setState({ busy: true });
    await this.fade(1, quick ? 120 : 260);
    this.planetView.dispose();
    sv.setSelected(index);
    this.planetView = new PlanetView(this.galaxy, sv.system, index, this.ctx);
    this.setView(this.planetView);
    this.setState({ selectedPlanet: index });
    const home = this.planetView.home();
    if (quick) {
      this.applyPose(home);
      await this.fade(0, 120);
    } else {
      this.applyPose({ ...home, position: home.position.clone().multiplyScalar(1.9) });
      const fadeIn = this.fade(0, 420);
      await this.flyTo(home.position, home.target, home.fov, 1300, ease.outQuint);
      await fadeIn;
    }
    this.setState({ busy: false });
  }

  /** 한 단계 위로: 행성 → 항성계 → 은하 → 선택 해제 */
  back(): void {
    if (this.state.busy) return;
    if (this.flightView) void this.stopFlight();
    else if (this.state.mode === 'planet') void this.exitPlanet();
    else if (this.state.mode === 'system') {
      if (this.state.selectedPlanet !== null) this.selectPlanet(null);
      else void this.exitSystem();
    } else if (this.state.selectedStar !== null) this.selectStar(null);
  }

  /** 은하 화면으로 곧장 돌아간다. 이동 경로의 어느 단계에서든. */
  async toGalaxy(): Promise<void> {
    if (this.state.busy) return;
    if (this.state.mode === 'planet') await this.exitPlanet();
    if (this.state.mode === 'system') await this.exitSystem();
  }

  async toSystem(): Promise<void> {
    if (this.state.busy || this.state.mode !== 'planet') return;
    await this.exitPlanet();
  }

  /** 주소에 담긴 좌표로 곧장 간다. 애니메이션 없이. */
  async restore(target: RestoreTarget): Promise<void> {
    const { star, planet, mode } = target;
    if (star === null || star < 0 || star >= this.galaxy.count) return;
    this.selectStar(star, false);
    const pos = this.galaxyView.starPosition(star);
    this.applyPose({ ...this.galaxyView.home(), position: pos.clone().add(new THREE.Vector3(0, 110, 200)), target: pos });
    if (mode === 'galaxy') return;
    await this.enterSystem(star, true);
    const system = this.state.system;
    if (planet === null || !system || planet < 0 || planet >= system.planets.length) return;
    if (mode === 'planet') await this.enterPlanet(planet, true);
    else this.selectPlanet(planet);
  }

  /** 일지 등에서 고른 좌표로 곧장 옮겨 간다. 화면을 가린 채로 은하·별·행성을 바꾼다. */
  async jump(target: RestoreTarget & { galaxy: string }): Promise<void> {
    if (this.state.busy) return;
    const quick = this.reducedMotion;
    this.setState({ busy: true });
    this.clearHover();
    await this.fade(1, quick ? 120 : 320);
    this.follow = null;
    this.disposeSubViews();
    this.setView(this.galaxyView);
    if (target.galaxy !== this.state.galaxyName) {
      this.galaxyView.dispose();
      this.loadGalaxy(target.galaxy);
    }
    this.setState({ mode: 'galaxy', selectedPlanet: null, busy: false });
    await this.restore(target);
    await this.fade(0, quick ? 120 : 550);
  }

  /** 탐사 일지에 있는 별을 은하 지도에 금색으로 표시한다. */
  setVisited(indices: number[]): void {
    this.galaxyView.setVisited(indices.filter((i) => i >= 0 && i < this.galaxy.count));
  }

  resetCamera(): void {
    if (this.state.busy) return;
    this.follow = null;
    const home = this.view.home();
    void this.flyTo(home.position, home.target, home.fov, this.reducedMotion ? 0 : 1200, ease.inOutCubic);
  }

  /** 패널에 가린 만큼 화면 중심을 옮긴다. 넓은 화면은 오른쪽 패널, 좁은 화면은 아래 시트. */
  setInsets(right: number, bottom: number): void {
    if (Math.abs(right - this.insetRight) < 1 && Math.abs(bottom - this.insetBottom) < 1) return;
    this.insetRight = right;
    this.insetBottom = bottom;
    this.resize();
  }

  // ── 키보드: 캔버스에 초점이 있을 때만 ────────────────────────────────────
  handleKey(e: KeyboardEvent): boolean {
    if (this.flightView) {
      // 비행 중: 좌우는 방향, 위아래는 높이. 누르고 있으면 키 반복으로 계속 돈다.
      const turn = e.shiftKey ? 0.12 : 0.05;
      switch (e.key) {
        case 'ArrowLeft': this.flightView.nudge(-turn, 0); return true;
        case 'ArrowRight': this.flightView.nudge(turn, 0); return true;
        case 'ArrowUp': this.flightView.nudge(0, 1); return true;
        case 'ArrowDown': this.flightView.nudge(0, -1); return true;
        default: return false;
      }
    }
    const step = e.shiftKey ? 0.2 : 0.07;
    switch (e.key) {
      case 'ArrowLeft': this.orbitBy(-step, 0); return true;
      case 'ArrowRight': this.orbitBy(step, 0); return true;
      case 'ArrowUp': this.orbitBy(0, -step); return true;
      case 'ArrowDown': this.orbitBy(0, step); return true;
      case 'PageUp': case '+': case '=': this.dollyBy(0.8); return true;
      case 'PageDown': case '-': this.dollyBy(1.25); return true;
      case 'Home': this.resetCamera(); return true;
      case 'Enter':
        if (this.photo) return false;
        if (this.state.mode === 'galaxy') void this.enterSystem();
        else if (this.state.mode === 'system') void this.enterPlanet();
        return true;
      default: return false;
    }
  }

  private orbitBy(dTheta: number, dPhi: number): void {
    if (this.tweening) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(offset);
    s.theta -= dTheta;
    s.phi = THREE.MathUtils.clamp(s.phi + dPhi, 0.05, Math.PI - 0.05);
    offset.setFromSpherical(s);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  private dollyBy(factor: number): void {
    if (this.tweening) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(len));
  }

  // ── 포인터 ───────────────────────────────────────────────────────────────
  private bindPointer(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('dblclick', this.onDoubleClick);
  }

  private setPointer(e: PointerEvent | MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    // 사진 모드에서는 구도를 잡다가 실수로 선택이 바뀌지 않게 클릭을 받지 않는다.
    if (this.state.busy || this.photo) return;
    this.setPointer(e);
    const hit = this.pickAtPointer();
    if (this.state.mode === 'galaxy') this.selectStar(hit >= 0 ? hit : null);
    else if (this.state.mode === 'system' && hit >= 0) this.selectPlanet(hit);
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (this.state.busy || this.photo) return;
    this.setPointer(e);
    const hit = this.pickAtPointer();
    if (hit < 0) return;
    if (this.state.mode === 'galaxy') void this.enterSystem(hit);
    else if (this.state.mode === 'system') void this.enterPlanet(hit);
  };

  private onPointerMove = (e: PointerEvent) => {
    // 비행 중 끌기: 가로는 방향, 세로는 높이
    if (this.flightView && e.buttons & 1 && this.lastDrag) {
      this.flightView.nudge((e.clientX - this.lastDrag.x) * 0.004, -(e.clientY - this.lastDrag.y) * 0.05);
    }
    this.lastDrag = { x: e.clientX, y: e.clientY };
    this.setPointer(e);
    this.pointerInside = true;
    this.hoverDirty = true;
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    this.clearHover();
  };

  private pickAtPointer(): number {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.state.mode === 'galaxy') {
      const maxAngle = (16 / this.height) * THREE.MathUtils.degToRad(this.camera.fov);
      return this.galaxyView.pick(this.raycaster.ray, maxAngle);
    }
    if (this.state.mode === 'system' && this.systemView) return this.systemView.pick(this.raycaster);
    return -1;
  }

  private updateHover(now: number): void {
    if (!this.hoverDirty || now - this.lastHover < 60 || this.state.busy || this.photo || !this.pointerInside || this.down) return;
    this.hoverDirty = false;
    this.lastHover = now;
    const hit = this.pickAtPointer();
    if (hit === this.hovered) return;
    this.hovered = hit;
    this.canvas.style.cursor = hit >= 0 ? 'pointer' : '';
    if (this.state.mode === 'galaxy') {
      this.galaxyView.setHover(hit >= 0 ? hit : null);
      if (hit >= 0) {
        const star = makeStar(this.galaxy, hit);
        const what = star.hole ? '블랙홀' : star.companion ? `${star.cls}형 쌍성` : `${star.cls}형`;
        this.labels.set('hover', `${star.name} · ${what}`, this.galaxyView.starPosition(hit), 'label--hover');
      } else this.labels.hide('hover');
    }
  }

  private clearHover(): void {
    this.hovered = -1;
    this.canvas.style.cursor = '';
    this.galaxyView?.setHover(null);
    this.labels.hide('hover');
  }

  // ── 카메라·전환 ─────────────────────────────────────────────────────────
  private setView(view: View): void {
    this.view = view;
    this.renderPass.scene = view.scene;
    const pr = Math.min(this.ctx.pixelRatio, view.maxPixelRatio ?? Infinity);
    if (pr !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this.resize();
    }
    this.applyBloom();
    this.applyGuides();
    this.clearHover();
  }

  private applyBloom(): void {
    const b = this.view.bloom;
    this.bloomPass.strength = b.strength * (this.photo?.bloom ?? 1);
    this.bloomPass.radius = b.radius;
    this.bloomPass.threshold = b.threshold;
  }

  /** 이름표·궤도선·표지. 사진 모드에서 끌 수 있다. 행성 화면에는 원래 이름표가 없다. */
  private applyGuides(): void {
    const show = this.photo ? this.photo.guides : true;
    this.labels.root.hidden = !show || this.view === this.planetView || this.state.warp !== null;
    this.galaxyView?.setGuidesVisible(show);
    this.systemView?.setGuidesVisible(show);
  }

  // ── 사진 모드 ───────────────────────────────────────────────────────────────
  /** null이면 사진 모드를 끝낸다. */
  setPhoto(settings: PhotoSettings | null): void {
    this.photo = settings;
    const u = this.gradePass.uniforms;
    this.gradePass.enabled = settings !== null;
    if (settings) {
      u.uExposure.value = settings.exposure;
      u.uSaturation.value = settings.saturation;
      u.uContrast.value = settings.contrast;
      u.uTint.value.set(...settings.tint);
      u.uMono.value = settings.mono;
      u.uVignette.value = settings.vignette;
      u.uGrain.value = settings.grain;
      this.clearHover();
    }
    this.applyBloom();
    this.applyGuides();
  }

  /**
   * 지금 화면을 한 장 그려 PNG로 돌려준다. WebGL 캔버스는 그린 직후에만 내용이 남아 있으므로
   * 같은 작업 안에서 2D 캔버스로 옮겨 자르고 테두리를 입힌다.
   */
  async capture(opts: CaptureOptions): Promise<Blob> {
    await Promise.all([
      document.fonts.load('800 40px "Nanum Myeongjo"'),
      document.fonts.load('400 20px "IBM Plex Mono"'),
    ]).catch(() => undefined);
    this.composer.render(0);
    const src = this.canvas;
    const sw = src.width;
    const sh = src.height;
    let cw = sw;
    let ch = sh;
    if (opts.aspect) {
      if (sw / sh > opts.aspect) cw = Math.round(sh * opts.aspect);
      else ch = Math.round(sw / opts.aspect);
    }
    const cx = Math.round((sw - cw) / 2);
    const cy = Math.round((sh - ch) / 2);
    const out = document.createElement('canvas');
    const ctx = out.getContext('2d')!;
    const unit = Math.min(cw, ch);

    if (opts.frame === 'postcard') {
      const m = Math.round(unit * 0.045);
      const band = Math.round(unit * 0.16);
      out.width = cw + m * 2;
      out.height = ch + m + band;
      ctx.fillStyle = '#f3eee2';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, cx, cy, cw, ch, m, m, cw, ch);
      ctx.fillStyle = '#1f1b14';
      ctx.font = `800 ${Math.round(band * 0.36)}px "Nanum Myeongjo", serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(opts.title, m, ch + m + band * 0.5);
      ctx.fillStyle = '#6f6656';
      ctx.font = `400 ${Math.round(band * 0.15)}px "IBM Plex Mono", "Malgun Gothic", monospace`;
      ctx.fillText(opts.subtitle, m, ch + m + band * 0.78);
      ctx.textAlign = 'right';
      ctx.fillText('MIRINAE', out.width - m, ch + m + band * 0.78);
    } else {
      out.width = cw;
      out.height = ch;
      ctx.drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);
      if (opts.frame === 'log') this.drawLogFrame(ctx, cw, ch, unit, opts);
    }
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  }

  /** 관측 기록 테두리: 네 귀퉁이 꺾쇠와 좌표 글씨 */
  private drawLogFrame(ctx: CanvasRenderingContext2D, w: number, h: number, unit: number, opts: CaptureOptions): void {
    const m = Math.round(unit * 0.04);
    const len = Math.round(unit * 0.06);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(2, Math.round(unit * 0.003));
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x, y + dy * len);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * len, y);
      ctx.stroke();
    }
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = unit * 0.01;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `500 ${Math.round(unit * 0.022)}px "IBM Plex Mono", monospace`;
    ctx.fillText('MIRINAE · OBSERVATION LOG', m * 1.6, m * 1.6 + unit * 0.02);
    ctx.font = `800 ${Math.round(unit * 0.055)}px "Nanum Myeongjo", serif`;
    ctx.fillText(opts.title, m * 1.6, h - m * 1.6 - unit * 0.04);
    ctx.font = `400 ${Math.round(unit * 0.02)}px "IBM Plex Mono", "Malgun Gothic", monospace`;
    ctx.fillText(opts.subtitle, m * 1.6, h - m * 1.6);
    ctx.shadowBlur = 0;
  }

  private poseNow(): CameraPose {
    return {
      position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov,
      near: this.camera.near, far: this.camera.far,
      minDistance: this.controls.minDistance, maxDistance: this.controls.maxDistance,
    };
  }

  /**
   * 카메라를 움직이는 유일한 통로. 새 이동이 시작되면 앞의 이동은 무효가 된다(그 트윈은 남은 시간 동안 아무것도 하지 않는다).
   * 끝까지 간 이동이면 true로 풀린다.
   */
  private moveCamera(duration: number, easing: Ease, step: (k: number) => void): Promise<boolean> {
    const id = ++this.cameraMove;
    this.tweening = true;
    return this.tweens.run(duration, easing, (k) => {
      if (id === this.cameraMove) step(k);
    }).then(() => {
      if (id !== this.cameraMove) return false;
      this.tweening = false;
      return true;
    });
  }

  private applyPose(pose: CameraPose): void {
    this.cameraMove++;
    this.tweening = false;
    this.camera.fov = pose.fov;
    this.camera.near = pose.near;
    this.camera.far = pose.far;
    this.camera.position.copy(pose.position);
    this.controls.target.copy(pose.target);
    this.controls.minDistance = pose.minDistance;
    this.controls.maxDistance = pose.maxDistance;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(pose.target);
  }

  private flyTo(position: THREE.Vector3, target: THREE.Vector3, fov: number, duration: number, easing: Ease): Promise<void> {
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    const f0 = this.camera.fov;
    const p1 = position.clone();
    const t1 = target.clone();
    return this.moveCamera(duration, easing, (k) => {
      this.camera.position.lerpVectors(p0, p1, k);
      this.controls.target.lerpVectors(t0, t1, k);
      this.camera.fov = f0 + (fov - f0) * k;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
    }).then(() => undefined);
  }

  private fade(to: number, duration: number): Promise<void> {
    const from = Number(this.fadeEl.style.opacity || 0);
    return this.tweens.run(duration, ease.inOutCubic, (k) => {
      this.fadeEl.style.opacity = String(from + (to - from) * k);
    });
  }

  private disposeSubViews(): void {
    this.endFlightNow();
    this.planetView?.dispose();
    this.planetView = null;
    this.systemView?.dispose();
    this.systemView = null;
    this.holeView?.dispose();
    this.holeView = null;
    this.labels.root.hidden = false;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    // 가상의 더 큰 화면을 만들고 그 일부만 보여 주면, 투영 중심이 가려지지 않은 영역 가운데로 온다.
    const r = this.insetRight;
    const b = this.insetBottom;
    if (r > 0 || b > 0) {
      this.camera.aspect = (w + r) / (h + b);
      this.camera.setViewOffset(w + r, h + b, r, b, w, h);
    } else {
      this.camera.aspect = w / h;
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    this.timer.update(now);
    const raw = this.timer.getDelta();
    // 궤도·자전은 프레임이 끊겨도 튀지 않게 dt를 묶고, 전환 연출은 실제 시간대로 끝나게 한다.
    const dt = Math.min(raw, 0.05);
    const time = this.timer.getElapsed();
    this.tweens.update(Math.min(raw, 0.5));
    if (this.follow && !this.tweening) {
      const p = this.follow();
      const delta = p.clone().sub(this.controls.target).multiplyScalar(1 - Math.exp(-dt * 6));
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    // 저공비행 중에는 비행 화면이 카메라를 직접 움직인다.
    if (!this.tweening && !this.flightView) this.controls.update();
    this.updateHover(now);
    // 사진 모드의 시간 멈춤: 장면 시간만 멈추고 카메라 조작과 전환은 그대로 둔다.
    const sdt = this.photo?.freeze ? 0 : dt;
    this.simTime += sdt;
    this.gradePass.uniforms.uTime.value = time;
    this.gradePass.uniforms.uAspect.value = this.width / this.height;
    this.view.update(sdt, this.simTime, this.camera);
    this.labels.update(this.camera, this.width, this.height);
    this.composer.render(dt);
  };

  // 잃은 컨텍스트에 계속 그리지 않도록 루프를 멈추고 화면에 알린다.
  // dispose의 forceContextLoss도 이 이벤트를 내므로, 정리 중일 때는 알리지 않는다.
  private contextLost = () => {
    cancelAnimationFrame(this.raf);
    if (this.disposed) return;
    this.onContextLost?.();
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scanToken++;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposeSubViews();
    this.warm?.dispose();
    this.warmHole?.dispose();
    this.galaxyView.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.root.remove();
    this.fadeEl.remove();
  }
}
