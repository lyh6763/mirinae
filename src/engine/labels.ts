import * as THREE from 'three';

interface Label {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  visible: boolean;
}

/**
 * 3D 위치를 따라다니는 글자 이름표. 매 프레임 React를 다시 그리지 않도록 DOM을 직접 옮긴다.
 * 같은 정보는 오른쪽 패널에 목록으로 있으므로 스크린리더에는 숨긴다.
 */
export class LabelLayer {
  readonly root: HTMLDivElement;
  private labels = new Map<string, Label>();
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    this.root.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.root);
  }

  set(id: string, text: string, pos: THREE.Vector3, className = ''): void {
    let label = this.labels.get(id);
    if (!label) {
      const el = document.createElement('div');
      this.root.appendChild(el);
      label = { el, pos: new THREE.Vector3(), visible: true };
      this.labels.set(id, label);
    }
    if (label.el.textContent !== text) label.el.textContent = text;
    const cls = `label ${className}`.trim();
    if (label.el.className !== cls) label.el.className = cls;
    label.pos.copy(pos);
    label.visible = true;
  }

  move(id: string, pos: THREE.Vector3): void {
    this.labels.get(id)?.pos.copy(pos);
  }

  hide(id: string): void {
    const label = this.labels.get(id);
    if (label) label.visible = false;
  }

  clear(prefix = ''): void {
    for (const [id, label] of this.labels) {
      if (!id.startsWith(prefix)) continue;
      label.el.remove();
      this.labels.delete(id);
    }
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    for (const label of this.labels.values()) {
      this.v.copy(label.pos).project(camera);
      const onScreen = label.visible && this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      label.el.style.opacity = onScreen ? '' : '0';
      if (!onScreen) continue;
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      label.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }
}
