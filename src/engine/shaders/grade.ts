import * as THREE from 'three';

/** 사진 모드의 색보정. OutputPass 뒤(화면 색 공간)에서 노출·채도·대비·색조·비네팅·필름 입자를 입힌다. */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uMono: { value: 0 },
    uVignette: { value: 0 },
    uGrain: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uTint;
    uniform float uMono;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col = src.rgb * uExposure;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = mix(col, vec3(luma), uMono);
      col = (col - 0.5) * uContrast + 0.5;
      col *= uTint;
      vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
      col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(c) * 1.25);
      col += (hash(vUv * 1024.0 + fract(uTime) * 97.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);
    }
  `,
};
