import * as THREE from 'three';
import type { Galaxy } from '../../gen/galaxy';
import { lookFor } from '../../gen/look';
import { hash32, Rng } from '../../gen/rng';
import type { StarSystem } from '../../gen/system';
import { planetMaterial } from '../shaders/bodies';
import { glowTexture } from '../textures';
import { makeSky, PlanetBody, spinSpeed } from './bodies';
import { starLight } from './SystemView';
import { disposeScene, type Bloom, type CameraPose, type View, type ViewContext } from './view';

interface Moon {
  pivot: THREE.Group;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  speed: number;
}

/** 해 하나: 행성 자체 좌표에서 본 방향과 빛 색 */
export interface Sun {
  dir: THREE.Vector3;
  color: THREE.Color;
}

/** 행성 하나를 가까이에서 본다. 해는 멀리 한 방향에 두고 밤낮 경계가 보이게 한다. */
export class PlanetView implements View {
  readonly scene = new THREE.Scene();
  readonly bloom: Bloom = { strength: 0.6, radius: 0.5, threshold: 0.85 };
  readonly body: PlanetBody;
  private sunPos = new THREE.Vector3(-34, 7, 20);
  private light: THREE.Color;
  private sun2Pos: THREE.Vector3 | null = null;
  private light2: THREE.Color | null = null;
  private moons: Moon[] = [];

  constructor(galaxy: Galaxy, readonly system: StarSystem, readonly index: number, private ctx: ViewContext) {
    const { star } = system;
    const planet = system.planets[index];
    const origin = new THREE.Vector3().fromArray(galaxy.positions, star.index * 3);
    this.scene.add(makeSky(galaxy, origin, ctx.pixelRatio));

    // 가까이서 보면 표면 무늬가 하얗게 날아가지 않도록 항성계 화면보다 빛을 줄인다.
    this.light = starLight(star.color).multiplyScalar(0.8);
    const color = new THREE.Color(star.color);
    for (const [scale, opacity] of [[26, 0.5], [6, 1]] as const) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity,
      }));
      glow.position.copy(this.sunPos);
      glow.scale.setScalar(scale * THREE.MathUtils.clamp(Math.sqrt(star.radius) / Math.sqrt(planet.orbitAU) * 0.6, 0.35, 2.5));
      this.scene.add(glow);
    }

    // 쌍성이면 하늘에 해가 둘. 둘째 해는 첫째 해 옆에 조금 떨어져 뜬다.
    const c = star.companion;
    let sun2: THREE.Vector3 | undefined;
    let light2: THREE.Color | undefined;
    if (c) {
      sun2 = this.sunPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.32).add(new THREE.Vector3(0, 5, 0));
      const share = THREE.MathUtils.clamp(Math.sqrt(c.luminosity / Math.max(star.luminosity, 1e-6)), 0.3, 1);
      // 두 빛을 합쳐도 홑별일 때와 비슷한 밝기가 되게 나눈다.
      this.light.multiplyScalar(1 / (1 + share * 0.6));
      light2 = starLight(c.color).multiplyScalar((0.8 * share) / (1 + share * 0.6));
      const color2 = new THREE.Color(c.color);
      for (const [scale, opacity] of [[18, 0.45], [4.5, 1]] as const) {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(), color: color2, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity,
        }));
        glow.position.copy(sun2);
        glow.scale.setScalar(scale * THREE.MathUtils.clamp(Math.sqrt(c.radius) / Math.sqrt(planet.orbitAU) * 0.6, 0.3, 2.2));
        this.scene.add(glow);
      }
      this.sun2Pos = sun2;
      this.light2 = light2;
    }

    this.body = new PlanetBody(planet, 1, 'high');
    this.body.setLight(this.sunPos, this.light, sun2, light2);
    this.scene.add(this.body.group);

    // 위성은 많아도 셋까지만 보여 준다.
    const rng = new Rng(hash32(planet.seed, 77));
    for (let m = 0; m < Math.min(planet.moons, 3); m++) {
      const seed = hash32(planet.seed, 78, m);
      const look = lookFor(new Rng(seed), 'rocky', { ocean: 0, life: 0, atmosphere: 'none', tempC: -100 });
      const mat = planetMaterial(look, seed, 5);
      mat.uniforms.uLightPos.value.copy(this.sunPos);
      mat.uniforms.uLightColor.value.copy(this.light);
      if (sun2 && light2) {
        mat.uniforms.uLightPos2.value.copy(sun2);
        mat.uniforms.uLightColor2.value.copy(light2);
      }
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rng.range(0.05, 0.13), 48, 24), mat);
      const pivot = new THREE.Group();
      pivot.rotation.set(rng.gauss() * 0.15, rng.range(0, Math.PI * 2), rng.gauss() * 0.1);
      mesh.position.x = (planet.rings ? 2.7 : 1.8) + m * 0.75 + rng.range(0, 0.3);
      pivot.add(mesh);
      this.scene.add(pivot);
      this.moons.push({ pivot, mesh, speed: rng.range(0.04, 0.12) / (m + 1) });
    }
  }

  /** 단단한 땅이 있어야 저공비행을 할 수 있다(가스 행성 제외). */
  get canFly(): boolean {
    return this.system.planets[this.index].look.kind !== 1;
  }

  /** 세계 좌표의 점을 행성 자체(자전하는 표면) 좌표의 방향으로. 지형 노이즈가 이 좌표를 쓴다. */
  localDirection(world: THREE.Vector3): THREE.Vector3 {
    this.body.surface.updateMatrixWorld(true);
    return this.body.surface.worldToLocal(world.clone()).normalize();
  }

  /** 저공비행에 넘길 해들. 쌍성이면 둘이다. */
  sunsLocal(): Sun[] {
    const suns: Sun[] = [{ dir: this.localDirection(this.sunPos), color: this.light.clone() }];
    if (this.sun2Pos && this.light2) suns.push({ dir: this.localDirection(this.sun2Pos), color: this.light2.clone() });
    return suns;
  }

  home(): CameraPose {
    const planet = this.system.planets[this.index];
    const d = planet.rings ? 4.4 : 3.1;
    return {
      position: new THREE.Vector3(d * 0.12, d * 0.16, d),
      target: new THREE.Vector3(0, 0, 0),
      fov: 45, near: 0.01, far: 20000,
      minDistance: 1.25, maxDistance: 10,
    };
  }

  update(dt: number, time: number): void {
    const motion = this.ctx.reducedMotion ? 0.2 : 1;
    this.body.update(dt, time, spinSpeed(this.body.planet) * 0.35 * motion);
    for (const moon of this.moons) {
      moon.pivot.rotation.y += dt * moon.speed * motion;
      moon.mesh.rotation.y += dt * 0.05;
    }
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}
