import { useEffect, useRef, useState } from 'react';
import type { Engine, EngineState, PhotoFrame, PhotoSettings } from '../engine/Engine';
import { PLANET_TYPE_LABEL } from '../gen/system';

export const PHOTO_DEFAULT: PhotoSettings = {
  exposure: 1, bloom: 1, saturation: 1, contrast: 1, tint: [1, 1, 1], mono: 0, vignette: 0.25, grain: 0,
  freeze: false, guides: false,
};

const PRESETS: { id: string; label: string; values: Partial<PhotoSettings> }[] = [
  { id: 'base', label: '기본', values: { saturation: 1, contrast: 1, tint: [1, 1, 1], mono: 0, vignette: 0.25, grain: 0, bloom: 1 } },
  { id: 'film', label: '흑백 필름', values: { saturation: 0, mono: 1, contrast: 1.18, tint: [1, 1, 1], vignette: 0.55, grain: 0.07, bloom: 0.9 } },
  { id: 'blueprint', label: '청사진', values: { saturation: 0.55, mono: 0, contrast: 1.1, tint: [0.78, 0.95, 1.18], vignette: 0.4, grain: 0.02, bloom: 1 } },
  { id: 'dusk', label: '황혼', values: { saturation: 1.15, mono: 0, contrast: 1.05, tint: [1.12, 0.94, 0.78], vignette: 0.45, grain: 0.02, bloom: 1.1 } },
  { id: 'neon', label: '네온', values: { saturation: 1.55, mono: 0, contrast: 1.2, tint: [1.02, 0.95, 1.1], vignette: 0.5, grain: 0, bloom: 1.7 } },
];

const SLIDERS: { key: 'exposure' | 'bloom' | 'saturation' | 'contrast' | 'vignette' | 'grain'; label: string; min: number; max: number; step: number }[] = [
  { key: 'exposure', label: '노출', min: 0.4, max: 2, step: 0.05 },
  { key: 'bloom', label: '빛번짐', min: 0, max: 2.5, step: 0.05 },
  { key: 'saturation', label: '채도', min: 0, max: 2, step: 0.05 },
  { key: 'contrast', label: '대비', min: 0.6, max: 1.6, step: 0.02 },
  { key: 'vignette', label: '비네팅', min: 0, max: 1, step: 0.05 },
  { key: 'grain', label: '필름 입자', min: 0, max: 0.15, step: 0.005 },
];

export const ASPECTS: { id: string; label: string; value: number | null }[] = [
  { id: 'screen', label: '화면 그대로', value: null },
  { id: '16x9', label: '16:9', value: 16 / 9 },
  { id: '1x1', label: '1:1', value: 1 },
  { id: '4x5', label: '4:5', value: 4 / 5 },
  { id: '9x16', label: '9:16', value: 9 / 16 },
];

const FRAMES: { id: PhotoFrame; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'postcard', label: '엽서' },
  { id: 'log', label: '관측 기록' },
];

/** 사진에 넣을 제목과 부제: 지금 보는 곳 */
export function caption(state: EngineState): { title: string; subtitle: string; file: string } {
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\s/g, '').replace(/\.$/, '');
  const sys = state.system;
  if (state.mode === 'planet' && sys && state.selectedPlanet !== null) {
    const p = sys.planets[state.selectedPlanet];
    return { title: p.name, subtitle: `${PLANET_TYPE_LABEL[p.type]} · ${sys.star.code} · 은하 ${state.galaxyName} · ${date}`, file: p.name };
  }
  if (state.mode === 'system' && sys) {
    return { title: sys.star.name, subtitle: `${sys.star.code} · ${sys.star.cls}형 · 은하 ${state.galaxyName} · ${date}`, file: sys.star.name };
  }
  return { title: `은하 ${state.galaxyName}`, subtitle: `별 ${state.starCount.toLocaleString('ko-KR')}개 · 나선팔 ${state.arms}개 · ${date}`, file: state.galaxyName };
}

interface Props {
  engine: Engine;
  state: EngineState;
  settings: PhotoSettings;
  onChange: (s: PhotoSettings) => void;
  aspect: string;
  onAspect: (id: string) => void;
  onExit: () => void;
  onSaved: (message: string) => void;
}

export function PhotoPanel({ engine, state, settings, onChange, aspect, onAspect, onExit, onSaved }: Props) {
  const [frame, setFrame] = useState<PhotoFrame>('none');
  const [preset, setPreset] = useState('base');
  const [folded, setFolded] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);

  const set = (patch: Partial<PhotoSettings>) => onChange({ ...settings, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      const cap = caption(state);
      const blob = await engine.capture({
        aspect: ASPECTS.find((a) => a.id === aspect)?.value ?? null,
        frame,
        title: cap.title,
        subtitle: cap.subtitle,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const name = `mirinae-${cap.file}.png`;
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      onSaved(`사진을 저장했습니다 · ${name}`);
    } catch {
      onSaved('사진을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`photo ${folded ? 'is-folded' : ''}`} aria-labelledby="photo-title">
      <div className="photo__head">
        <h2 id="photo-title" className="photo__title" tabIndex={-1} ref={titleRef}>사진 모드</h2>
        <button type="button" className="btn btn--small" aria-expanded={!folded} aria-controls="photo-controls" onClick={() => setFolded(!folded)}>
          {folded ? '조절판 펼치기' : '조절판 접기'}
        </button>
      </div>

      <div id="photo-controls" className="photo__body" hidden={folded}>
        <fieldset className="photo__group">
          <legend>색감</legend>
          <div className="chips">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="filter"
                aria-pressed={preset === p.id}
                onClick={() => {
                  setPreset(p.id);
                  set(p.values);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="photo__sliders">
          {SLIDERS.map((s) => (
            <label key={s.key} className="slider">
              <span className="slider__label">{s.label}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={settings[s.key]}
                onChange={(e) => set({ [s.key]: Number(e.target.value) })}
              />
              <span className="slider__value mono" aria-hidden="true">{settings[s.key].toFixed(2)}</span>
            </label>
          ))}
        </div>

        <div className="photo__toggles">
          <label className="check">
            <input type="checkbox" checked={settings.freeze} onChange={(e) => set({ freeze: e.target.checked })} />
            시간 멈추기
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.guides} onChange={(e) => set({ guides: e.target.checked })} />
            이름표·궤도선 보이기
          </label>
        </div>

        <fieldset className="photo__group">
          <legend>화면비</legend>
          <div className="chips">
            {ASPECTS.map((a) => (
              <button key={a.id} type="button" className="filter" aria-pressed={aspect === a.id} onClick={() => onAspect(a.id)}>
                {a.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="photo__group">
          <legend>테두리</legend>
          <div className="chips">
            {FRAMES.map((f) => (
              <button key={f.id} type="button" className="filter" aria-pressed={frame === f.id} onClick={() => setFrame(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="photo__actions">
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving}>
          {saving ? '저장하는 중…' : '사진 저장 (PNG)'}
        </button>
        <button type="button" className="btn" onClick={onExit}>사진 모드 끝내기</button>
      </div>
      <p className="hint photo__hint">끌어서 구도를 잡고 휠로 확대합니다. Esc로 끝냅니다.</p>
    </section>
  );
}
