import type * as THREE from 'three';
import type { LabelLayer } from '../labels';

export interface Bloom {
  strength: number;
  radius: number;
  threshold: number;
}

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  near: number;
  far: number;
  minDistance: number;
  maxDistance: number;
}

export interface ViewContext {
  pixelRatio: number;
  labels: LabelLayer;
  reducedMotion: boolean;
}

export interface View {
  readonly scene: THREE.Scene;
  readonly bloom: Bloom;
  /** 픽셀마다 무거운 계산을 하는 화면은 해상도 상한을 둔다. */
  readonly maxPixelRatio?: number;
  home(): CameraPose;
  update(dt: number, time: number, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

/** 장면 아래의 모든 지오메트리·재질을 정리한다. 공유 텍스처는 건드리지 않는다. */
export function disposeScene(scene: THREE.Object3D, keep: Set<unknown> = new Set()): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !keep.has(mesh.geometry)) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
  });
}
