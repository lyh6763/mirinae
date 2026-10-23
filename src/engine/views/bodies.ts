import * as THREE from 'three';
import type { Galaxy } from '../../gen/galaxy';
import type { Planet } from '../../gen/system';
import { skyMaterial } from '../shaders/points';
import { atmosphereMaterial, cloudMaterial, planetMaterial, ringMaterial } from '../shaders/bodies';

/** 행성 하나(표면·구름·대기·고리)를 반지름 radius로 만든다. 항성계와 행성 화면이 함께 쓴다. */
export class PlanetBody {
  readonly group = new THREE.Group();
  readonly spin = new THREE.Group();
  readonly surface: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private lit: THREE.ShaderMaterial[] = [];
  private timed: THREE.ShaderMaterial[] = [];
  private clouds: THREE.Mesh | null = null;
  private ringMaterial: THREE.ShaderMaterial | null = null;

  constructor(readonly planet: Planet, radius: number, detail: 'low' | 'high') {
    const look = planet.look;
    const seg = detail === 'high' ? 256 : 64;
    const mat = planetMaterial(look, planet.seed, detail === 'high' ? 7 : 5);
    mat.uniforms.uBump.value = detail === 'high' ? 0.05 : 0.03;
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(radius, seg, seg / 2), mat);
    this.spin.add(this.surface);
    this.lit.push(mat);
    this.timed.push(mat);

    if (look.clouds > 0.02) {
      const cm = cloudMaterial(look, planet.seed);
      this.clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, seg, seg / 2), cm);
      this.spin.add(this.clouds);
      this.lit.push(cm);
      this.timed.push(cm);
    }

    this.group.add(this.spin);

    if (look.atmosphereStrength > 0.01) {
      const front = atmosphereMaterial(look, false);
      const halo = atmosphereMaterial(look, true);
      this.group.add(
        new THREE.Mesh(new THREE.SphereGeometry(radius * 1.018, seg, seg / 2), front),
        new THREE.Mesh(new THREE.SphereGeometry(radius * 1.11, seg, seg / 2), halo),
      );
      this.lit.push(front, halo);
    }

    if (planet.rings) {
      const inner = radius * 1.35;
      const outer = radius * (planet.type === 'gas' ? 2.35 : 1.9);
      const rm = ringMaterial(look.ringColor, inner, outer, planet.seed);
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 160, 1), rm);
      ring.rotation.x = -Math.PI / 2;
      this.spin.add(ring);
      this.ringMaterial = rm;
    }

    // 자전축 기울기
    this.group.rotation.z = THREE.MathUtils.degToRad(Math.min(planet.tilt, 40));
  }

  /** 해 하나 또는 둘(쌍성). 둘째 해가 없으면 그 색을 검정으로 둔다. */
  setLight(worldPos: THREE.Vector3, color: THREE.Color, worldPos2?: THREE.Vector3, color2?: THREE.Color): void {
    for (const m of this.lit) {
      const u = m.uniforms;
      u.uLightPos?.value.copy(worldPos);
      u.uLightColor?.value.copy(color);
      if (worldPos2) u.uLightPos2?.value.copy(worldPos2);
      if (u.uLightColor2) u.uLightColor2.value.copy(color2 ?? BLACK);
      if (u.uHas2) u.uHas2.value = color2 ? 1 : 0;
    }
    this.ringMaterial?.uniforms.uLightColor.value.copy(color);
    this.ringMaterial?.uniforms.uLightColor2.value.copy(color2 ?? BLACK);
  }

  update(dt: number, time: number, spinSpeed: number): void {
    for (const m of this.timed) m.uniforms.uTime.value = time;
    this.surface.rotation.y += dt * spinSpeed;
    if (this.clouds) this.clouds.rotation.y += dt * spinSpeed * 1.15;
  }
}

const BLACK = new THREE.Color(0, 0, 0);

/** 자전 속도(라디안/초). 실제 하루 길이를 화면용으로 줄였다. 조석 고정이면 돌지 않는다. */
export function spinSpeed(planet: Planet): number {
  if (planet.dayHours === null) return 0;
  return 0.9 / Math.sqrt(planet.dayHours);
}

/** 은하의 모든 별을 origin에서 본 하늘로 찍는다. */
export function makeSky(galaxy: Galaxy, origin: THREE.Vector3, pixelRatio: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(galaxy.positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(galaxy.colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(galaxy.sizes, 1));
  const sky = new THREE.Points(geo, skyMaterial(pixelRatio, origin));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}
