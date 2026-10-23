import * as THREE from 'three';
import { SPECTRAL_CLASSES, SPECTRAL_LOOK, type Galaxy } from '../../gen/galaxy';
import { hash32, Rng } from '../../gen/rng';
import { streakMaterial } from '../shaders/points';
import { glowTexture } from '../textures';
import { makeSky } from './bodies';
import { disposeScene, type Bloom, type CameraPose, type View, type ViewContext } from './view';

const DUST = 1400;
const DUST_DEPTH = 320;

/**
 * 별과 별 사이를 나는 화면. 실제 은하의 별들을 '지금 위치'에서 본 하늘로 그리고 그 위치를 출발 별에서
 * 도착 별까지 옮긴다. 가까운 별은 시차로 크게 스쳐 지나가며 빛줄기를 남긴다. 그 위에 화면 쪽으로
 * 쏟아지는 빛가루를 얹어 속도감을 더한다.
 */
export class WarpView implements View {
  readonly scene = new THREE.Scene();
  readonly bloom: Bloom = { strength: 1.1, radius: 0.6, threshold: 0.25 };
  readonly distance: number;
  private sky: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private streaks: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private dust: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private dustSeed: Float32Array;
  private beacon: THREE.Sprite;
  private from: THREE.Vector3;
  private to: THREE.Vector3;
  private dir: THREE.Vector3;
  private origin = new THREE.Vector3();
  private progress = 0;
  private prevProgress = 0;
  private speed = 0;

  constructor(galaxy: Galaxy, fromIndex: number, toIndex: number, ctx: ViewContext) {
    this.from = new THREE.Vector3().fromArray(galaxy.positions, fromIndex * 3);
    this.to = new THREE.Vector3().fromArray(galaxy.positions, toIndex * 3);
    this.dir = this.to.clone().sub(this.from);
    this.distance = this.dir.length();
    this.dir.normalize();

    this.sky = makeSky(galaxy, this.from, ctx.pixelRatio) as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

    // 별마다 꼭짓점 두 개(머리·꼬리)를 둔 선분
    const n = galaxy.count;
    const pos = new Float32Array(n * 6);
    const col = new Float32Array(n * 6);
    const size = new Float32Array(n * 2);
    const end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      for (let e = 0; e < 2; e++) {
        const v = i * 2 + e;
        pos.set(galaxy.positions.subarray(i * 3, i * 3 + 3), v * 3);
        col.set(galaxy.colors.subarray(i * 3, i * 3 + 3), v * 3);
        size[v] = galaxy.sizes[i];
        end[v] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.streaks = new THREE.LineSegments(geo, streakMaterial());
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = -9;

    // 빛가루: 카메라를 둘러싼 원통 안의 짧은 선. 카메라를 따라다닌다.
    const rng = new Rng(hash32(fromIndex, toIndex, 31));
    this.dustSeed = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = 2.5 + Math.pow(rng.next(), 0.6) * 38;
      this.dustSeed.set([Math.cos(a) * r, Math.sin(a) * r, -rng.range(0, DUST_DEPTH)], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 6), 3));
    this.dust = new THREE.LineSegments(dustGeo, new THREE.LineBasicMaterial({
      color: new THREE.Color('#b9d2ff'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.dust.frustumCulled = false;

    // 도착할 별: 다가갈수록 커지는 빛
    const color = new THREE.Color(SPECTRAL_LOOK[SPECTRAL_CLASSES[galaxy.classes[toIndex]]].color);
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
    }));

    this.scene.add(this.sky, this.streaks, this.dust, this.beacon);
  }

  home(): CameraPose {
    return {
      position: new THREE.Vector3(0, 0, 0),
      target: this.dir.clone().multiplyScalar(10),
      fov: 62, near: 0.1, far: 2000,
      minDistance: 10, maxDistance: 10,
    };
  }

  /** 0이면 출발 별, 1이면 도착 별 */
  setProgress(k: number): void {
    this.progress = k;
  }

  update(dt: number, _time: number, camera: THREE.PerspectiveCamera): void {
    const v = dt > 0 ? ((this.progress - this.prevProgress) * this.distance) / dt : 0;
    this.prevProgress = this.progress;
    this.speed += (v - this.speed) * Math.min(1, dt * 6);

    this.origin.lerpVectors(this.from, this.to, this.progress);
    this.sky.material.uniforms.uOrigin.value.copy(this.origin);
    const trail = Math.min(this.speed * 0.35, 7);
    const u = this.streaks.material.uniforms;
    u.uHead.value.copy(this.origin);
    u.uTail.value.copy(this.origin).addScaledVector(this.dir, -trail);

    // 빛가루는 카메라 좌표계에서 앞(-z)에서 뒤(+z)로 흐른다.
    const k = THREE.MathUtils.clamp(this.speed / 18, 0, 1);
    this.dust.position.copy(camera.position);
    this.dust.quaternion.copy(camera.quaternion);
    this.dust.material.opacity = k * 0.75;
    const flow = 30 + this.speed * 16;
    const len = 0.3 + flow * 0.045;
    const seed = this.dustSeed;
    const out = this.dust.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < DUST; i++) {
      let z = seed[i * 3 + 2] + flow * dt;
      if (z > 2) z -= DUST_DEPTH;
      seed[i * 3 + 2] = z;
      const x = seed[i * 3];
      const y = seed[i * 3 + 1];
      out.set([x, y, z, x, y, z - len], i * 6);
    }
    this.dust.geometry.attributes.position.needsUpdate = true;

    const remaining = this.distance * (1 - this.progress);
    this.beacon.position.copy(camera.position).addScaledVector(this.dir, 60);
    this.beacon.scale.setScalar(THREE.MathUtils.clamp(140 / (remaining + 3), 0.8, 30));
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
