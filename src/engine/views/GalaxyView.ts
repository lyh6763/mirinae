import * as THREE from 'three';
import { GALAXY_RADIUS, type Galaxy } from '../../gen/galaxy';
import { hash32, Rng } from '../../gen/rng';
import { dustMaterial, nebulaMaterial, starPointsMaterial } from '../shaders/points';
import { glowTexture, markerTexture } from '../textures';
import { disposeScene, type Bloom, type CameraPose, type View, type ViewContext } from './view';

/** 은하 전체를 내려다보는 화면. 별 16만 개 하나하나가 고를 수 있는 항성계다. */
export class GalaxyView implements View {
  readonly scene = new THREE.Scene();
  readonly bloom: Bloom = { strength: 0.75, radius: 0.65, threshold: 0.22 };
  readonly starGeometry: THREE.BufferGeometry;
  readonly nebulaGeometry: THREE.BufferGeometry;
  private selectMarker: THREE.Sprite;
  private hoverMarker: THREE.Sprite;
  private signalMarkers: THREE.Points;
  private visitedMarkers: THREE.Points;
  private guides = new THREE.Group();
  private signalPositions: number[] = [];
  private v = new THREE.Vector3();
  private glows: THREE.SpriteMaterial[] = [];
  private glowBase = [0.36, 0.07];
  private starMaterial: THREE.ShaderMaterial;

  constructor(readonly galaxy: Galaxy, private ctx: ViewContext) {
    this.starGeometry = new THREE.BufferGeometry();
    this.starGeometry.setAttribute('position', new THREE.BufferAttribute(galaxy.positions, 3));
    this.starGeometry.setAttribute('aColor', new THREE.BufferAttribute(galaxy.colors, 3));
    this.starGeometry.setAttribute('aSize', new THREE.BufferAttribute(galaxy.sizes, 1));
    this.starGeometry.computeBoundingSphere();
    const stars = new THREE.Points(this.starGeometry, starPointsMaterial(ctx.pixelRatio));
    stars.frustumCulled = false;

    const n = galaxy.nebula;
    this.nebulaGeometry = new THREE.BufferGeometry();
    this.nebulaGeometry.setAttribute('position', new THREE.BufferAttribute(n.positions, 3));
    this.nebulaGeometry.setAttribute('aColor', new THREE.BufferAttribute(n.colors, 3));
    this.nebulaGeometry.setAttribute('aSize', new THREE.BufferAttribute(n.sizes, 1));
    const nebula = new THREE.Points(this.nebulaGeometry, nebulaMaterial(ctx.pixelRatio));
    nebula.frustumCulled = false;
    nebula.renderOrder = -1;

    // 먼지띠는 별을 다 그린 뒤에 덮어 빛을 깎는다.
    const d = galaxy.dust;
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    dustGeometry.setAttribute('aColor', new THREE.BufferAttribute(d.colors, 3));
    dustGeometry.setAttribute('aSize', new THREE.BufferAttribute(d.sizes, 1));
    const dust = new THREE.Points(dustGeometry, dustMaterial(ctx.pixelRatio));
    dust.frustumCulled = false;
    dust.renderOrder = 1;

    // 은하 중심의 따뜻한 빛
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: new THREE.Color('#ffcf96'), blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.36,
    }));
    core.scale.setScalar(GALAXY_RADIUS * 0.7);
    const halo = core.clone();
    halo.material = (core.material as THREE.SpriteMaterial).clone();
    (halo.material as THREE.SpriteMaterial).opacity = 0.07;
    (halo.material as THREE.SpriteMaterial).color = new THREE.Color('#9fb4ff');
    halo.scale.setScalar(GALAXY_RADIUS * 2.6);

    this.scene.add(this.backdrop(galaxy.seed), nebula, halo, core, stars, dust);
    this.glows = [core.material, halo.material as THREE.SpriteMaterial];
    this.starMaterial = stars.material;

    const markerMat = new THREE.SpriteMaterial({
      map: markerTexture(), color: new THREE.Color('#f0cf86'), depthTest: false, depthWrite: false, transparent: true,
    });
    this.selectMarker = new THREE.Sprite(markerMat);
    this.selectMarker.visible = false;
    this.selectMarker.renderOrder = 10;
    this.hoverMarker = new THREE.Sprite(markerMat.clone());
    (this.hoverMarker.material as THREE.SpriteMaterial).opacity = 0.45;
    this.hoverMarker.visible = false;
    this.hoverMarker.renderOrder = 10;

    // 문명 신호가 잡힌 별은 분홍 점으로 겹쳐 표시한다.
    this.signalMarkers = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: new THREE.Color('#ff7fcf'), size: 9 * ctx.pixelRatio, sizeAttenuation: false,
        map: glowTexture(), transparent: true, depthWrite: false, depthTest: false, opacity: 0.75,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.signalMarkers.frustumCulled = false;
    this.signalMarkers.renderOrder = 9;

    // 탐사 일지에 있는 별: 금색 점
    this.visitedMarkers = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: new THREE.Color('#ffd27a'), size: 11 * ctx.pixelRatio, sizeAttenuation: false,
        map: glowTexture(), transparent: true, depthWrite: false, depthTest: false, opacity: 0.9,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.visitedMarkers.frustumCulled = false;
    this.visitedMarkers.renderOrder = 9;
    this.guides.add(this.selectMarker, this.hoverMarker, this.signalMarkers, this.visitedMarkers);
    this.scene.add(this.guides);
  }

  /** 선택 표지·신호·다녀간 별 점을 한꺼번에 숨긴다(사진 모드). */
  setGuidesVisible(show: boolean): void {
    this.guides.visible = show;
  }

  setVisited(indices: number[]): void {
    const pos = new Float32Array(indices.length * 3);
    indices.forEach((i, k) => pos.set(this.galaxy.positions.subarray(i * 3, i * 3 + 3), k * 3));
    this.visitedMarkers.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  }

  /** 아주 먼 배경 별. 이웃 은하 쪽 하늘이라 고를 수 없다. */
  private backdrop(seed: number): THREE.Points {
    const rng = new Rng(hash32(seed, 99));
    const count = 5000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rng.range(-1, 1);
      const t = rng.range(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(t) * s * 12000, u * 12000, Math.sin(t) * s * 12000], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color('#8890a8'), size: 1.1 * this.ctx.pixelRatio, sizeAttenuation: false,
      transparent: true, opacity: 0.5, depthWrite: false,
    }));
    pts.frustumCulled = false;
    pts.renderOrder = -2;
    return pts;
  }

  home(): CameraPose {
    return {
      position: new THREE.Vector3(0, GALAXY_RADIUS * 1.55, GALAXY_RADIUS * 1.75),
      target: new THREE.Vector3(0, 0, 0),
      fov: 55, near: 0.5, far: 40000,
      minDistance: 6, maxDistance: GALAXY_RADIUS * 4,
    };
  }

  starPosition(index: number, out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.galaxy.positions;
    return out.set(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]);
  }

  /**
   * 광선에 가장 가까운 별을 찾는다. three의 Points 레이캐스트는 후보마다 객체를 만들어 느려서
   * 배열을 직접 훑는다. 큰 별일수록 조금 더 잘 잡히게 한다.
   */
  pick(ray: THREE.Ray, maxAngle: number): number {
    const p = this.galaxy.positions;
    const s = this.galaxy.sizes;
    const { x: ox, y: oy, z: oz } = ray.origin;
    const { x: dx, y: dy, z: dz } = ray.direction;
    const max2 = maxAngle * maxAngle;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0, n = this.galaxy.count; i < n; i++) {
      const vx = p[i * 3] - ox;
      const vy = p[i * 3 + 1] - oy;
      const vz = p[i * 3 + 2] - oz;
      const t = vx * dx + vy * dy + vz * dz;
      if (t <= 0.5) continue;
      const perp2 = vx * vx + vy * vy + vz * vz - t * t;
      const ang2 = perp2 / (t * t);
      if (ang2 > max2) continue;
      const score = ang2 / (s[i] * s[i]) * (1 + t * 0.0004);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  setSelected(index: number | null): void {
    this.selectMarker.visible = index !== null;
    if (index !== null) this.starPosition(index, this.selectMarker.position);
  }

  setHover(index: number | null): void {
    this.hoverMarker.visible = index !== null;
    if (index !== null) this.starPosition(index, this.hoverMarker.position);
  }

  addSignals(indices: number[]): void {
    for (const i of indices) this.signalPositions.push(...this.starPosition(i, this.v).toArray());
    this.signalMarkers.geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.signalPositions, 3));
  }

  update(_dt: number, time: number, camera: THREE.PerspectiveCamera): void {
    // 은하 중심 가까이 들어가면 빛이 겹겹이 쌓여 화면이 하얗게 탄다. 가까울수록 중심 빛과 별 밝기를 줄인다.
    const core = THREE.MathUtils.smoothstep(camera.position.length(), 120, 900);
    this.glows.forEach((m, i) => (m.opacity = this.glowBase[i] * core));
    this.starMaterial.uniforms.uBoost.value = 1.25 * (0.4 + 0.6 * core);

    // 표지는 거리와 상관없이 화면에서 같은 크기로 보이게 한다.
    const k = Math.tan((camera.fov * Math.PI) / 360) * 0.06;
    for (const m of [this.selectMarker, this.hoverMarker]) {
      if (!m.visible) continue;
      m.scale.setScalar(camera.position.distanceTo(m.position) * k);
    }
    const pulse = 0.9 + Math.sin(time * 3) * 0.1;
    this.selectMarker.material.rotation = time * 0.4;
    this.selectMarker.material.opacity = pulse;
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
