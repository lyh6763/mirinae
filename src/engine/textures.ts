import * as THREE from 'three';

let glow: THREE.Texture | null = null;
let marker: THREE.Texture | null = null;

/** 가운데가 밝고 바깥으로 사라지는 둥근 빛. 항성 후광과 은하 중심 빛에 쓴다. */
export function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.14)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.03)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glow = new THREE.CanvasTexture(canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}

/** 고른 별을 둘러싸는 표지: 가는 원과 네 방향 눈금. */
export function markerTexture(): THREE.Texture {
  if (marker) return marker;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 4;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * c * 0.74, c + Math.sin(a) * c * 0.74);
    ctx.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95);
    ctx.stroke();
  }
  marker = new THREE.CanvasTexture(canvas);
  marker.colorSpace = THREE.SRGBColorSpace;
  return marker;
}
