import * as THREE from 'three';
import type { Galaxy } from '../../gen/galaxy';
import { hash32, Rng } from '../../gen/rng';
import type { StarSystem } from '../../gen/system';
import { starSurfaceMaterial } from '../shaders/bodies';
import { glowTexture, markerTexture } from '../textures';
import { makeSky, PlanetBody, spinSpeed } from './bodies';
import { disposeScene, type Bloom, type CameraPose, type View, type ViewContext } from './view';

interface Orbiter {
  body: PlanetBody;
  orbit: THREE.Group;
  line: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  hit: THREE.Mesh;
  radius: number;
  size: number;
  angle: number;
  speed: number;
}

/** 별의 표시용 빛 색: 별 색을 흰색 쪽으로 반쯤 섞는다. 붉은 별 곁 행성도 알아볼 수 있게. */
export function starLight(color: string): THREE.Color {
  return new THREE.Color('#ffffff').lerp(new THREE.Color(color), 0.45).multiplyScalar(1.25);
}

/** 별 하나와 그 행성들. 궤도 반지름은 실제 비율 대신 로그로 줄여 한 화면에 담는다. */
export class SystemView implements View {
  readonly scene = new THREE.Scene();
  readonly bloom: Bloom = { strength: 1.15, radius: 0.55, threshold: 0.4 };
  readonly starRadius: number;
  private orbiters: Orbiter[] = [];
  private starMats: THREE.ShaderMaterial[] = [];
  private light: THREE.Color;
  private sunA: THREE.Group;
  private sunB: THREE.Group | null = null;
  private lightB: THREE.Color | null = null;
  private binaryOffsets: [number, number] = [0, 0];
  private binaryAngle = 0;
  private binarySpeed = 0;
  private marker: THREE.Sprite;
  private outer: number;
  private selected: number | null = null;
  private hz: THREE.Mesh;
  private guides = true;
  frozen = false;

  constructor(galaxy: Galaxy, readonly system: StarSystem, private ctx: ViewContext) {
    const { star, planets } = system;
    const origin = new THREE.Vector3().fromArray(galaxy.positions, star.index * 3);
    this.scene.add(makeSky(galaxy, origin, ctx.pixelRatio));

    this.light = starLight(star.color);
    this.starRadius = THREE.MathUtils.clamp(0.9 + 0.55 * Math.cbrt(star.radius), 0.8, 3.2);
    const a = makeSun(star.color, this.starRadius);
    this.starMats.push(a.mat);
    this.sunA = a.group;
    this.scene.add(a.group);

    // 쌍성: 두 별이 무게중심을 돈다. 화면에서는 두 별이 맞닿지 않을 만큼만 떨어뜨린다.
    let inner = this.starRadius * 3;
    const c = star.companion;
    if (c) {
      const rB = THREE.MathUtils.clamp(0.9 + 0.55 * Math.cbrt(c.radius), 0.7, 3.0) * 0.9;
      const b = makeSun(c.color, rB);
      this.starMats.push(b.mat);
      this.sunB = b.group;
      this.scene.add(b.group);
      const d = (this.starRadius + rB) * 1.7;
      const total = star.mass + c.mass;
      this.binaryOffsets = [-d * (c.mass / total), d * (star.mass / total)];
      this.binarySpeed = 0.5 * (ctx.reducedMotion ? 0.15 : 1);
      this.lightB = starLight(c.color).multiplyScalar(THREE.MathUtils.clamp(Math.sqrt(c.luminosity / Math.max(star.luminosity, 1e-6)), 0.3, 1));
      inner = Math.max(inner, d * 2.1);
    }

    // 궤도 반지름: 첫 행성 기준 로그 거리 + 행성끼리 겹치지 않을 최소 간격
    const sizes = planets.map((p) => THREE.MathUtils.clamp(0.22 + 0.27 * Math.sqrt(p.radiusEarth), 0.28, 1.25));
    const a0 = planets[0]?.orbitAU ?? star.habitable[0] * 0.5;
    const base = (au: number) => inner + 5.5 * Math.log2(1 + au / a0);
    const radii: number[] = [];
    planets.forEach((p, i) => {
      const r = base(p.orbitAU);
      radii.push(i === 0 ? r : Math.max(r, radii[i - 1] + 1.4 + sizes[i] + sizes[i - 1]));
    });
    const auToR = (au: number): number => {
      if (radii.length === 0) return base(au);
      if (au <= planets[0].orbitAU) return this.starRadius * 1.5 + (radii[0] - this.starRadius * 1.5) * (au / planets[0].orbitAU);
      for (let i = 1; i < radii.length; i++) {
        if (au <= planets[i].orbitAU) {
          const t = Math.log(au / planets[i - 1].orbitAU) / Math.log(planets[i].orbitAU / planets[i - 1].orbitAU);
          return radii[i - 1] + (radii[i] - radii[i - 1]) * t;
        }
      }
      const last = planets.length - 1;
      return radii[last] + 5.5 * Math.log2(au / planets[last].orbitAU);
    };
    this.outer = radii.length ? radii[radii.length - 1] : this.starRadius * 6;

    // 거주 가능 구역: 물이 액체로 있을 수 있는 거리
    const [hzIn, hzOut] = star.habitable.map(auToR);
    const hz = new THREE.Mesh(
      new THREE.RingGeometry(hzIn, hzOut, 192, 1),
      new THREE.MeshBasicMaterial({ color: '#6dffa8', transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false }),
    );
    hz.rotation.x = -Math.PI / 2;
    this.scene.add(hz);
    this.hz = hz;

    const rng = new Rng(hash32(star.seed, 404));
    planets.forEach((planet, i) => {
      const orbit = new THREE.Group();
      orbit.rotation.set(rng.gauss() * 0.03, rng.range(0, Math.PI * 2), rng.gauss() * 0.03);
      const radius = radii[i];
      const line = new THREE.LineLoop(
        circle(radius, 256),
        new THREE.LineBasicMaterial({ color: '#9aa8c8', transparent: true, opacity: 0.2, depthWrite: false }),
      );
      orbit.add(line);

      const body = new PlanetBody(planet, sizes[i], 'low');
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(sizes[i] * 1.9, 1.0), 12, 8),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.userData.planet = i;
      body.group.add(hit);
      orbit.add(body.group);
      this.scene.add(orbit);

      this.orbiters.push({
        body, orbit, line, hit, radius, size: sizes[i],
        angle: rng.range(0, Math.PI * 2),
        speed: Math.max(0.012, 0.32 * Math.pow(a0 / planet.orbitAU, 1.5)) * (ctx.reducedMotion ? 0.15 : 1),
      });
    });

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: markerTexture(), color: new THREE.Color('#f0cf86'), depthTest: false, depthWrite: false, transparent: true,
    }));
    this.marker.visible = false;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);

    ctx.labels.set('star', star.name, new THREE.Vector3(0, -this.starRadius * 1.25, 0), 'label--star');
    planets.forEach((p, i) => ctx.labels.set(`p${i}`, p.name, new THREE.Vector3(), 'label--planet'));
    this.update(0, 0);
  }

  home(): CameraPose {
    const r = Math.max(this.outer, this.starRadius * 6);
    return {
      position: new THREE.Vector3(0, r * 0.78, r * 1.7),
      target: new THREE.Vector3(0, 0, 0),
      fov: 50, near: 0.05, far: 20000,
      minDistance: this.starRadius * 1.6, maxDistance: r * 5,
    };
  }

  planetPosition(index: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.orbiters[index].body.group.getWorldPosition(out);
  }

  planetSize(index: number): number {
    return this.orbiters[index].size;
  }

  pick(raycaster: THREE.Raycaster): number {
    const hits = raycaster.intersectObjects(this.orbiters.map((o) => o.hit), false);
    return hits.length ? (hits[0].object.userData.planet as number) : -1;
  }

  setSelected(index: number | null): void {
    this.selected = index;
    this.orbiters.forEach((o, i) => {
      o.line.material.color.set(i === index ? '#f0cf86' : '#9aa8c8');
      o.line.material.opacity = i === index ? 0.65 : 0.2;
    });
    this.marker.visible = index !== null && this.guides;
  }

  /** 궤도선·거주 가능 구역·선택 표지를 숨긴다(사진 모드). */
  setGuidesVisible(show: boolean): void {
    this.guides = show;
    this.orbiters.forEach((o) => (o.line.visible = show));
    this.hz.visible = show;
    this.marker.visible = show && this.selected !== null;
  }

  update(dt: number, time: number, camera?: THREE.PerspectiveCamera): void {
    for (const m of this.starMats) m.uniforms.uTime.value = time;
    if (this.sunB) {
      if (!this.frozen) this.binaryAngle += dt * this.binarySpeed;
      const [oa, ob] = this.binaryOffsets;
      const cx = Math.cos(this.binaryAngle);
      const sz = Math.sin(this.binaryAngle);
      this.sunA.position.set(cx * oa, 0, sz * oa);
      this.sunB.position.set(cx * ob, 0, sz * ob);
    }
    const pos = new THREE.Vector3();
    this.orbiters.forEach((o, i) => {
      if (!this.frozen) o.angle += o.speed * dt;
      o.body.group.position.set(Math.cos(o.angle) * o.radius, 0, Math.sin(o.angle) * o.radius);
      if (this.sunB && this.lightB) o.body.setLight(this.sunA.position, this.light, this.sunB.position, this.lightB);
      else o.body.setLight(this.sunA.position, this.light);
      o.body.update(dt, time, spinSpeed(o.body.planet) * (this.ctx.reducedMotion ? 0.2 : 1));
      o.body.group.getWorldPosition(pos);
      pos.y += o.size * 1.6 + 0.35;
      this.ctx.labels.move(`p${i}`, pos);
    });
    if (camera && this.selected !== null && this.marker.visible) {
      this.planetPosition(this.selected, this.marker.position);
      const k = Math.tan((camera.fov * Math.PI) / 360) * 0.075;
      this.marker.scale.setScalar(Math.max(camera.position.distanceTo(this.marker.position) * k, this.orbiters[this.selected].size * 3.2));
      this.marker.material.rotation = time * 0.4;
    }
  }

  dispose(): void {
    this.ctx.labels.clear('p');
    this.ctx.labels.clear('star');
    disposeScene(this.scene);
  }
}

/** 별 하나: 표면 구와 두 겹의 빛무리 */
function makeSun(hex: string, radius: number): { group: THREE.Group; mat: THREE.ShaderMaterial } {
  const color = new THREE.Color(hex);
  const group = new THREE.Group();
  const mat = starSurfaceMaterial(color);
  group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), mat));
  for (const [scale, opacity] of [[16, 0.42], [5.5, 0.85]] as const) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity,
    }));
    glow.scale.setScalar(radius * scale);
    group.add(glow);
  }
  return { group, mat };
}

function circle(radius: number, segments: number): THREE.BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}
