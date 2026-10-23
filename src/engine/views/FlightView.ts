import * as THREE from 'three';
import type { Galaxy } from '../../gen/galaxy';
import type { StarSystem } from '../../gen/system';
import { surfaceHeight, terrainOffset } from '../../gen/terrain';
import { cloudMaterial, flightMaterial, skyDomeMaterial } from '../shaders/bodies';
import { makeSky } from './bodies';
import type { Sun } from './PlanetView';
import { disposeScene, type Bloom, type CameraPose, type View, type ViewContext } from './view';

/** 화면 단위: 행성 반지름 = 1,000 */
const R = 1000;
/** 지형 높이 1(노이즈 단위)이 몇 단위로 솟는지. 실제보다 과장해 산맥이 또렷하게 보이게 했다. */
const AMP = 22;
/** 위의 과장 비율(지구 산맥 대비 약 10배). 계기의 높이는 이 비율로 줄여 산과 같은 축척으로 보여 준다. */
export const VERTICAL_EXAGGERATION = 10;
const CELLS = 384;
const CELL = 1.2;
/** 출발점에서 이만큼 멀어지면 기준점을 옮겨 투영 왜곡을 막는다. */
const REBASE = 260;
const FOG_DENSITY = 0.0085;
const DUSK = new THREE.Color(1, 0.5, 0.25);

export interface FlightTelemetry {
  /** 지면 위 높이(km). 높낮이 과장 비율을 되돌린 값 */
  altitudeKm: number;
  /** 아래 지면의 해발(km). 바다면 0 */
  groundKm: number;
  /** 진행 방향(도). 출발할 때 방향이 0 */
  heading: number;
  overWater: boolean;
}

/**
 * 행성 표면 바로 위를 나는 화면. 카메라 아래 지면을 격자로 만들어 셰이더가 높이만큼 들어 올리고,
 * 카메라 고도는 CPU에서 같은 높이 함수를 앞쪽까지 읽어 산을 미리 넘는다.
 */
export class FlightView implements View {
  readonly scene = new THREE.Scene();
  readonly bloom: Bloom = { strength: 0.55, radius: 0.5, threshold: 0.85 };
  readonly maxPixelRatio = 1.25;
  auto = true;
  speed = 34;
  clearance = 7;
  private ground: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private clouds: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private c0 = new THREE.Vector3();
  private t = new THREE.Vector3();
  private b = new THREE.Vector3();
  private x = 0;
  private z = 0;
  private heading = 0;
  private yawRate = 0;
  private alt: number;
  private offset: [number, number, number];
  private sunDir: THREE.Vector3;
  private sun2Dir: THREE.Vector3 | null;
  private atmo: THREE.Color;
  private density: number;
  private kmPerUnit: number;
  private v = new THREE.Vector3();
  private telemetry: FlightTelemetry = { altitudeKm: 0, groundKm: 0, heading: 0, overWater: false };
  /** 지금까지 꺾은 방향의 합(기준점을 옮겨도 이어진다) */
  private turned = 0;

  constructor(galaxy: Galaxy, readonly system: StarSystem, readonly index: number, start: THREE.Vector3, suns: Sun[], ctx: ViewContext) {
    const planet = system.planets[index];
    const look = planet.look;
    this.offset = terrainOffset(planet.seed);
    this.sunDir = suns[0].dir.clone().normalize();
    this.sun2Dir = suns[1]?.dir.clone().normalize() ?? null;
    this.kmPerUnit = (planet.radiusEarth * 6371) / R;
    const light = suns[0].color;
    const light2 = suns[1]?.color;

    // 하늘: 별(대기가 짙으면 낮 하늘에 묻힌다), 대기 돔, 구름 층
    const origin = new THREE.Vector3().fromArray(galaxy.positions, system.star.index * 3);
    this.stars = makeSky(galaxy, origin, ctx.pixelRatio) as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    this.scene.add(this.stars);
    this.atmo = new THREE.Color(look.atmosphere);
    this.density = Math.min(1, look.atmosphereStrength);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), skyDomeMaterial(this.atmo, this.density, light, light2));
    this.dome.renderOrder = -5;
    this.dome.frustumCulled = false;
    this.dome.material.uniforms.uSunDir.value.copy(this.sunDir);
    if (this.sun2Dir) this.dome.material.uniforms.uSunDir2.value.copy(this.sun2Dir);
    this.scene.add(this.dome);

    // 해는 아주 멀리 있으므로 방향 × 큰 거리를 광원 위치로 쓴다. 쌍성이면 둘째 해도 함께.
    const lightUp = (u: Record<string, THREE.IUniform>) => {
      u.uLightPos.value.copy(this.sunDir).multiplyScalar(1e6);
      u.uLightColor.value.copy(light);
      if (this.sun2Dir && light2) {
        u.uLightPos2.value.copy(this.sun2Dir).multiplyScalar(1e6);
        u.uLightColor2.value.copy(light2);
      }
    };

    const mat = flightMaterial(look, planet.seed, AMP, R);
    lightUp(mat.uniforms);
    // 제곱 지수 안개: 50단위 16% · 100단위 51% · 지평선(약 140) 76% · 격자 끝(230) 거의 100%.
    mat.uniforms.uFogDensity.value = FOG_DENSITY;
    this.ground = new THREE.Mesh(grid(), mat);
    this.ground.frustumCulled = false;
    this.scene.add(this.ground);

    if (look.clouds > 0.02) {
      const cm = cloudMaterial(look, planet.seed);
      cm.side = THREE.DoubleSide;
      cm.uniforms.uFogDensity.value = FOG_DENSITY;
      lightUp(cm.uniforms);
      this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R + 32, 256, 128), cm);
      this.clouds.frustumCulled = false;
      this.scene.add(this.clouds);
    }

    this.rebase(start.clone().normalize(), null);
    this.alt = this.groundAt(0, 0) + this.clearance;
  }

  /** 지면 위 높이(R 기준 고도). 바다면 해수면. */
  private groundAt(x: number, z: number): number {
    const d = this.v.copy(this.c0).multiplyScalar(R).addScaledVector(this.t, x).addScaledVector(this.b, z).normalize();
    return AMP * surfaceHeight(this.system.planets[this.index].look, this.offset, 7, d.x, d.y, d.z);
  }

  private surfacePoint(x: number, z: number, alt: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.c0).multiplyScalar(R).addScaledVector(this.t, x).addScaledVector(this.b, z).normalize().multiplyScalar(R + alt);
  }

  /** 기준점을 바꾼다. 진행 방향은 유지한다. */
  private rebase(center: THREE.Vector3, forward: THREE.Vector3 | null): void {
    this.c0.copy(center);
    const f = forward ?? new THREE.Vector3(0, 1, 0).cross(center);
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0);
    // t = 지금 진행 방향을 접평면에 투영한 것, b = 그와 직각
    this.t.copy(f).addScaledVector(center, -f.dot(center)).normalize();
    this.b.crossVectors(this.t, center).normalize();
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    const u = this.ground?.material.uniforms;
    if (u) {
      u.uC0.value.copy(this.c0);
      u.uT.value.copy(this.t);
      u.uB.value.copy(this.b);
    }
  }

  /** 끌기·화살표로 방향과 높이를 바꾼다. */
  nudge(yaw: number, climb: number): void {
    this.heading += yaw;
    this.turned += yaw;
    this.clearance = THREE.MathUtils.clamp(this.clearance + climb, 2.5, 26);
  }

  home(): CameraPose {
    const eye = this.surfacePoint(0, 0, this.alt, new THREE.Vector3());
    const ahead = this.surfacePoint(40, 0, this.alt - 6, new THREE.Vector3());
    return { position: eye, target: ahead, fov: 62, near: 0.1, far: 4000, minDistance: 0.01, maxDistance: 10 };
  }

  getTelemetry(): FlightTelemetry {
    return this.telemetry;
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera): void {
    // 자동 비행이면 경치를 보도록 천천히 굽이친다.
    const wander = this.auto ? Math.sin(time * 0.13) * 0.11 + Math.sin(time * 0.047 + 1.3) * 0.08 : 0;
    const prev = this.heading;
    this.heading += wander * dt;
    const fx = Math.cos(this.heading);
    const fz = Math.sin(this.heading);
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;
    this.yawRate += ((this.heading - prev) / Math.max(dt, 1e-3) - this.yawRate) * Math.min(1, dt * 3);

    if (this.x * this.x + this.z * this.z > REBASE * REBASE) {
      const here = this.surfacePoint(this.x, this.z, 0, new THREE.Vector3()).normalize();
      const fwd = this.surfacePoint(this.x + fx, this.z + fz, 0, new THREE.Vector3()).normalize().sub(here);
      this.rebase(here, fwd);
    }

    // 산을 미리 넘도록 앞쪽 지면까지 읽는다.
    const hx = Math.cos(this.heading);
    const hz = Math.sin(this.heading);
    const g0 = this.groundAt(this.x, this.z);
    const ahead = Math.max(this.groundAt(this.x + hx * 25, this.z + hz * 25), this.groundAt(this.x + hx * 55, this.z + hz * 55) * 0.92);
    const target = Math.max(g0, ahead) + this.clearance;
    this.alt += (target - this.alt) * (1 - Math.exp(-dt * 2.2));
    this.alt = Math.max(this.alt, g0 + 1.2);

    const eye = this.surfacePoint(this.x, this.z, this.alt, new THREE.Vector3());
    const look = this.surfacePoint(this.x + hx * 45, this.z + hz * 45, this.alt - 5.5, new THREE.Vector3());
    camera.position.copy(eye);
    camera.up.copy(eye).normalize();
    camera.lookAt(look);
    // 도는 쪽으로 살짝 기운다.
    camera.rotateZ(THREE.MathUtils.clamp(-this.yawRate * 0.5, -0.35, 0.35));
    camera.updateMatrixWorld();

    // 격자는 칸 크기 단위로만 따라간다.
    const u = this.ground.material.uniforms;
    u.uGridCenter.value.set(Math.round(this.x / CELL) * CELL, Math.round(this.z / CELL) * CELL);
    u.uTime.value = time;

    // 하늘과 안개 색: 해가 떠 있는 정도에 따라 대기 색을 밝히고, 해가 낮으면 붉게.
    const up = this.v.copy(eye).normalize();
    // 쌍성이면 더 높이 뜬 해가 하늘의 밝기를 정한다.
    const sunUp = Math.max(up.dot(this.sunDir), this.sun2Dir ? up.dot(this.sun2Dir) : -1);
    const day = THREE.MathUtils.smoothstep(sunUp, -0.22, 0.2);
    const low = (1 - THREE.MathUtils.smoothstep(sunUp, -0.05, 0.35)) * day;
    // 안개 색 = 하늘 돔의 지평선 색(SKY_DOME_FRAG의 horizon과 같은 식). 그래야 먼 지형이 띠 없이 하늘에 녹는다.
    const fog = this.atmo.clone().multiplyScalar(0.95).lerp(DUSK, low * 0.75).multiplyScalar((0.04 + 0.96 * day) * this.density);
    u.uFogColor.value.copy(fog);
    // 대기가 짙은 낮 하늘에서는 별이 보이지 않는다. 대기가 없으면 낮에도 별이 보인다.
    this.stars.material.uniforms.uFade.value = 1 - day * this.density * 0.95;
    this.dome.position.copy(eye);
    this.dome.material.uniforms.uUp.value.copy(up);
    if (this.clouds) {
      const cu = this.clouds.material.uniforms;
      cu.uTime.value = time;
      cu.uFogColor.value.copy(fog);
    }

    this.turned += this.heading - prev;
    const g = g0 / AMP;
    const look0 = this.system.planets[this.index].look;
    const overWater = look0.seaLevel > -1.5 && g <= look0.seaLevel + 1e-4;
    const sea = look0.seaLevel > -1.5 ? look0.seaLevel * AMP : -0.55 * AMP;
    this.telemetry = {
      altitudeKm: ((this.alt - g0) * this.kmPerUnit) / VERTICAL_EXAGGERATION,
      groundKm: overWater ? 0 : Math.max(0, ((g0 - sea) * this.kmPerUnit) / VERTICAL_EXAGGERATION),
      heading: ((THREE.MathUtils.radToDeg(this.turned) % 360) + 360) % 360,
      overWater,
    };
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}

/** 가운데가 원점인 평평한 격자(CELLS × CELLS 칸). 꼭짓점 셰이더가 구면으로 바꾼다. */
function grid(): THREE.BufferGeometry {
  const n = CELLS + 1;
  const pos = new Float32Array(n * n * 3);
  const half = (CELLS * CELL) / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pos.set([i * CELL - half, 0, j * CELL - half], (j * n + i) * 3);
    }
  }
  const index = new Uint32Array(CELLS * CELLS * 6);
  let k = 0;
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      index.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}
