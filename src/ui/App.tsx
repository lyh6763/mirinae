import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Soundscape, type SoundScene } from '../audio/Soundscape';
import { Engine, type EngineState, type PhotoSettings } from '../engine/Engine';
import { ASPECTS, PHOTO_DEFAULT, PhotoPanel } from './PhotoPanel';
import { PLANET_TYPE_LABEL } from '../gen/system';
import { josa, kindLabel, lightYears, ro } from './format';
import { entryKey, logStore, planetVisit, systemVisit } from './log';
import { LogDialog } from './LogDialog';
import { Panel } from './panels';
import { formatHash, parseHash } from './route';

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const route = parseHash(location.hash);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let created: Engine;
    try {
      created = new Engine(stageRef.current!, route.galaxy, reduced);
    } catch {
      setFailed(true);
      return;
    }
    setEngine(created);
    void created.restore(route);
    // 개발 중 콘솔에서 엔진을 만져 볼 수 있게 한다.
    if (import.meta.env.DEV) Object.assign(window, { mirinae: created });
    return () => {
      created.dispose();
      setEngine(null);
    };
  }, []);

  return (
    <div className="app">
      {engine && <Hud engine={engine} />}
      {failed && (
        <div className="fallback" role="alert">
          <p className="title">미리내</p>
          <p>이 브라우저에서는 WebGL을 쓸 수 없어 은하를 그리지 못했습니다. 최신 Chrome·Edge·Firefox·Safari에서 열어 주세요.</p>
        </div>
      )}
      <div ref={stageRef} className="stage" />
    </div>
  );
}

/** 사진 모드에서 저장될 영역을 보여 준다. 바깥은 어둡게 덮는다. */
function CropGuide({ aspect }: { aspect: number | null }) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  if (!aspect) return null;
  let w = size.w;
  let h = size.h;
  if (w / h > aspect) w = h * aspect;
  else h = w / aspect;
  return (
    <div
      className="crop"
      aria-hidden="true"
      style={{ width: w, height: h, left: (size.w - w) / 2, top: (size.h - h) / 2 }}
    />
  );
}

const VOLUME_KEY = 'mirinae:volume';

function readVolume(): number {
  try {
    // 저장된 적이 없을 때만 기본값을 쓴다. 0(음소거)도 사용자가 고른 값이라 그대로 되살린다.
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null || raw.trim() === '') return 60;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : 60;
  } catch {
    return 60;
  }
}

/** 지금 화면에 맞는 배경음 장면 */
function sceneOf(state: EngineState): SoundScene {
  if (state.warp) return { kind: 'warp' };
  const sys = state.system;
  if (state.mode === 'planet' && sys && state.selectedPlanet !== null) {
    const p = sys.planets[state.selectedPlanet];
    return { kind: 'planet', type: p.type, temperatureK: sys.star.temperatureK, civ: p.life === 3, seed: p.seed };
  }
  if (state.mode === 'system' && sys?.star.hole) return { kind: 'hole', core: sys.star.kind === 'core', seed: sys.star.seed };
  if (state.mode === 'system' && sys) {
    return { kind: 'system', temperatureK: sys.star.temperatureK, civ: sys.planets.some((p) => p.life === 3), seed: sys.star.seed };
  }
  return { kind: 'galaxy' };
}

/** 워프 중 화면 가운데 아래의 계기판. 시작과 도착은 따로 소리 내어 알리므로 숫자는 스크린리더에 숨긴다. */
function WarpHud({ warp }: { warp: NonNullable<EngineState['warp']> }) {
  const left = warp.distanceLy * (1 - warp.progress);
  return (
    <div className="warp-hud" aria-hidden="true">
      <p className="warp-hud__label">워프 · {warp.fromName} → {warp.name}</p>
      <p className="warp-hud__left">
        <span className="mono">{Math.round(left).toLocaleString('ko-KR')}</span> 광년 남음
      </p>
      <div className="warp-hud__bar">
        <span style={{ width: `${warp.progress * 100}%` }} />
      </div>
    </div>
  );
}

const HINTS: Record<EngineState['mode'], string[]> = {
  galaxy: ['끌기 회전', '휠 확대', '클릭 별 고르기', '두 번 클릭 · Enter 들어가기'],
  system: ['클릭 행성 고르기', '두 번 클릭 · Enter 내려가기', 'Esc 뒤로'],
  planet: ['끌기 둘러보기', '휠 확대', 'Esc 항성계로'],
};
const FLIGHT_HINTS = ['← → 방향', '↑ ↓ 높이', '끌어서 조종', 'Esc 궤도로'];

function Hud({ engine }: { engine: Engine }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const panelRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [toast, setToast] = useState('');
  const prev = useRef(state);

  // 지금 보는 곳을 주소에 남겨 그대로 공유할 수 있게 한다.
  useEffect(() => {
    const hash = formatHash({ galaxy: state.galaxyName, star: state.selectedStar, planet: state.selectedPlanet, mode: state.mode });
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }, [state.galaxyName, state.selectedStar, state.selectedPlanet, state.mode]);

  // 스크린리더 안내와 초점 이동
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    const sys = state.system;
    let message = '';
    if (state.flight && !before.flight && sys && state.selectedPlanet !== null) {
      message = `${sys.planets[state.selectedPlanet].name} 표면 위로 저공비행을 시작합니다. 화살표로 방향과 높이를 바꿉니다.`;
    } else if (!state.flight && before.flight) {
      message = '비행을 마치고 궤도로 돌아왔습니다.';
    } else if (state.warp && !before.warp) {
      message = `${state.warp.fromName}에서 ${ro(state.warp.name)} 워프합니다. 거리 ${lightYears(state.warp.distanceLy)}.`;
    } else if (!state.warp && before.warp && sys) {
      message = `${sys.star.name} 항성계에 도착했습니다. 행성 ${sys.planets.length}개.`;
    } else if (state.galaxyName !== before.galaxyName) {
      message = `새 은하 ${josa(state.galaxyName, '이', '가')} 만들어졌습니다. 별 ${state.starCount.toLocaleString('ko-KR')}개.`;
    } else if (state.mode !== before.mode && sys) {
      if (state.mode === 'system') message = `${sys.star.name} 항성계에 들어왔습니다. 행성 ${sys.planets.length}개.`;
      else if (state.mode === 'planet' && state.selectedPlanet !== null) {
        const p = sys.planets[state.selectedPlanet];
        message = `${p.name}에 내려왔습니다. ${PLANET_TYPE_LABEL[p.type]}.`;
      } else if (state.mode === 'galaxy') message = `은하 ${ro(state.galaxyName)} 돌아왔습니다.`;
    } else if (state.mode === 'planet' && state.selectedPlanet !== before.selectedPlanet && sys && state.selectedPlanet !== null) {
      const p = sys.planets[state.selectedPlanet];
      message = `${p.name}. ${PLANET_TYPE_LABEL[p.type]}.`;
    } else if (state.mode === 'galaxy' && state.selectedStar !== before.selectedStar) {
      message = sys ? `${sys.star.name} 선택. ${kindLabel(sys.star)}, 행성 ${sys.planets.length}개.` : '선택을 풀었습니다.';
    } else if (state.mode === 'system' && state.selectedPlanet !== before.selectedPlanet && sys) {
      const p = state.selectedPlanet !== null ? sys.planets[state.selectedPlanet] : null;
      message = p ? `${p.name} 선택. ${PLANET_TYPE_LABEL[p.type]}.` : '행성 선택을 풀었습니다.';
    }
    if (message) setAnnouncement(message);

    // 화면 단계가 바뀌었고 초점이 패널이나 문서 본문에 있었다면 새 제목으로 옮긴다.
    const arrived = !state.warp && before.warp !== null;
    if (state.mode !== before.mode || state.galaxyName !== before.galaxyName || arrived || state.flight !== before.flight) {
      const active = document.activeElement;
      // 효과는 화면을 새로 그린 뒤에 돌므로 새 제목이 이미 있다. 탭이 뒤에 있어 화면 갱신이 멈춰도 동작하도록
      // requestAnimationFrame을 거치지 않는다.
      if (!active || active === document.body || panelRef.current?.contains(active)) {
        document.getElementById('panel-title')?.focus({ preventScroll: true });
      }
    }
  }, [state]);

  // ── 사진 모드 ──
  const [photo, setPhoto] = useState<PhotoSettings | null>(null);
  const [aspect, setAspect] = useState('screen');
  const photoButton = useRef<HTMLButtonElement>(null);
  const photoRef = useRef(photo);
  photoRef.current = photo;
  useEffect(() => engine.setPhoto(photo), [engine, photo]);
  // 사진 모드를 끝내면 숨겼던 머리말이 다시 그려진 뒤 '사진 모드' 단추로 초점을 돌려준다.
  const focusPhotoButton = () => setTimeout(() => photoButton.current?.focus(), 0);
  const exitPhoto = () => {
    setPhoto(null);
    focusPhotoButton();
  };

  // Esc는 어디서든 뒤로. 입력칸 안에서는 입력칸 몫으로 둔다. 사진 모드에서는 사진 모드를 끝낸다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      // 열린 대화상자가 있으면 Esc는 그 대화상자를 닫는 데만 쓴다.
      if (document.querySelector('dialog[open]')) return;
      if (photoRef.current) {
        setPhoto(null);
        focusPhotoButton();
        return;
      }
      engine.back();
    };
    const onCanvasKey = (e: KeyboardEvent) => {
      if (engine.handleKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    engine.canvas.addEventListener('keydown', onCanvasKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      engine.canvas.removeEventListener('keydown', onCanvasKey);
    };
  }, [engine]);

  // 패널에 가린 만큼 우주의 중심을 옮긴다: 넓은 화면은 왼쪽으로, 좁은 화면은 위로.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const update = () => {
      // 사진 모드는 화면 전체로 구도를 잡는다.
      if (photoRef.current) return engine.setInsets(0, 0);
      const wide = window.innerWidth >= 900;
      engine.setInsets(wide ? panel.offsetWidth + 24 : 0, wide ? 0 : panel.offsetHeight + 12);
    };
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [engine, photo !== null]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  // ── 우주 배경음: 기본은 꺼짐. 켜기 단추를 눌러야 소리가 난다(자동 재생 금지). ──
  const sound = useMemo(() => new Soundscape(), []);
  const [soundOn, setSoundOn] = useState(false);
  const [volume, setVolume] = useState(() => readVolume());
  useEffect(() => {
    if (import.meta.env.DEV) Object.assign(window, { mirinaeSound: sound });
    return () => {
      sound.dispose();
      setSoundOn(false);
    };
  }, [sound]);
  useEffect(() => {
    sound.setVolume(volume / 100);
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // 저장이 막혀도 이번 방문 동안은 그대로 쓴다.
    }
  }, [sound, volume]);
  useEffect(() => {
    sound.setScene(sceneOf(state));
  }, [sound, state.mode, state.system, state.selectedPlanet, state.warp !== null]);
  useEffect(() => {
    if (state.mode === 'galaxy' && state.system) sound.ping(state.system.star.temperatureK);
  }, [sound, state.selectedStar]);
  useEffect(() => {
    if (state.warp && state.warp.progress === 0) sound.warp(state.warp.durationMs);
  }, [sound, state.warp?.to]);
  const toggleSound = async () => {
    if (sound.on) {
      sound.disable();
      setSoundOn(false);
      return;
    }
    try {
      await sound.enable();
      setSoundOn(true);
    } catch {
      setToast('이 브라우저에서는 소리를 낼 수 없습니다.');
    }
  };

  // ── 탐사 일지: 항성계·행성에 들어가면 저절로 적는다 ──
  const log = useSyncExternalStore(logStore.subscribe, logStore.getSnapshot);
  const [logOpen, setLogOpen] = useState(false);
  const recorded = useRef({ system: '', planet: '' });
  useEffect(() => {
    if (state.mode === 'galaxy') {
      recorded.current = { system: '', planet: '' };
      return;
    }
    if (state.busy || !state.system) return;
    const sys = state.system;
    const sysKey = entryKey(state.galaxyName, sys.star.index, null);
    if (recorded.current.system !== sysKey) {
      recorded.current = { system: sysKey, planet: '' };
      if (logStore.visit(systemVisit(state.galaxyName, sys))) {
        setToast(`새 항성계 기록 · ${sys.star.name}`);
        sound.chime('new');
      }
    }
    if (state.mode === 'planet' && state.selectedPlanet !== null) {
      const planetKey = entryKey(state.galaxyName, sys.star.index, state.selectedPlanet);
      if (recorded.current.planet !== planetKey) {
        recorded.current.planet = planetKey;
        const p = sys.planets[state.selectedPlanet];
        if (logStore.visit(planetVisit(state.galaxyName, sys, state.selectedPlanet))) {
          setToast(p.life === 3 ? `문명 접촉 · ${p.name}` : p.life > 0 ? `생명 발견 · ${p.name}` : `새 발견 · ${p.name}`);
          sound.chime(p.life === 3 ? 'civ' : p.life > 0 ? 'life' : 'new');
        }
      }
    } else if (state.mode === 'system') {
      recorded.current.planet = '';
    }
  }, [state.mode, state.system, state.selectedPlanet, state.busy, state.galaxyName]);

  // 워프를 마치면 횟수와 거리를 더한다.
  const lastWarp = useRef<EngineState['warp']>(null);
  useEffect(() => {
    if (state.warp) lastWarp.current = state.warp;
    else if (lastWarp.current) {
      logStore.warp(lastWarp.current.distanceLy);
      lastWarp.current = null;
    }
  }, [state.warp]);

  // 다녀간 별을 은하 지도에 표시한다.
  useEffect(() => {
    const stars = new Set(log.entries.filter((e) => e.galaxy === state.galaxyName).map((e) => e.star));
    engine.setVisited([...stars]);
  }, [engine, log, state.galaxyName]);

  useEffect(() => {
    engine.canvas.setAttribute('aria-label', `${HINTS[state.mode].join(', ')}. 화살표 키로 회전, PageUp과 PageDown으로 확대와 축소, Home으로 처음 시점.`);
  }, [engine, state.mode]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setToast('지금 보는 곳의 좌표 링크를 복사했습니다.');
    } catch {
      setToast('복사하지 못했습니다. 주소창의 링크를 그대로 공유하세요.');
    }
  };

  const sys = state.system;
  const planet = state.mode === 'planet' && sys && state.selectedPlanet !== null ? sys.planets[state.selectedPlanet] : null;

  return (
    <>
      <header className="topbar" hidden={photo !== null}>
        <h1 className="brand">
          <span className="brand__ko">미리내</span>
          <span className="brand__en">MIRINAE · 은하 탐사기</span>
        </h1>
        <nav className="crumbs" aria-label="현재 위치">
          <ol>
            <li>
              <button type="button" onClick={() => void engine.toGalaxy()} aria-current={state.mode === 'galaxy' ? 'location' : undefined} disabled={state.busy}>
                은하 {state.galaxyName}
              </button>
            </li>
            {sys && state.mode !== 'galaxy' && (
              <li>
                <button type="button" onClick={() => void engine.toSystem()} aria-current={state.mode === 'system' ? 'location' : undefined} disabled={state.busy}>
                  {sys.star.name}
                </button>
              </li>
            )}
            {planet && (
              <li>
                <span aria-current="location">{planet.name}</span>
              </li>
            )}
          </ol>
        </nav>
        <div className="tools">
          <button type="button" className="tool" onClick={() => setLogOpen(true)} aria-haspopup="dialog">
            탐사 일지 <span className="tool__count">{log.entries.length}</span>
          </button>
          <button type="button" className="tool" aria-pressed={soundOn} onClick={() => void toggleSound()}>
            <span aria-hidden="true">{soundOn ? '♪' : '♩'}</span> 배경음
          </button>
          <button type="button" className="tool" ref={photoButton} onClick={() => setPhoto({ ...PHOTO_DEFAULT })} disabled={state.busy}>
            사진 모드
          </button>
          {soundOn && (
            <label className="tool tool--volume">
              음량
              <input type="range" min={0} max={100} step={5} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
            </label>
          )}
        </div>
      </header>

      <LogDialog open={logOpen} onClose={() => setLogOpen(false)} engine={engine} busy={state.busy} />

      <aside ref={panelRef} className="panel" aria-labelledby="panel-title" hidden={photo !== null}>
        <Panel state={state} engine={engine} />
      </aside>

      {photo && (
        <>
          <CropGuide aspect={ASPECTS.find((a) => a.id === aspect)?.value ?? null} />
          <PhotoPanel
            engine={engine}
            state={state}
            settings={photo}
            onChange={setPhoto}
            aspect={aspect}
            onAspect={setAspect}
            onExit={exitPhoto}
            onSaved={setToast}
          />
        </>
      )}

      <footer className="hints" hidden={photo !== null}>
        <ul aria-label="조작 방법">
          {(state.flight ? FLIGHT_HINTS : HINTS[state.mode]).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
        <button type="button" className="btn btn--small" onClick={() => void copyLink()}>좌표 링크 복사</button>
        <button type="button" className="btn btn--small" onClick={() => engine.resetCamera()} disabled={state.busy}>처음 시점</button>
      </footer>

      {state.warp && <WarpHud warp={state.warp} />}

      <p className="sr-only" aria-live="polite">{announcement}</p>
      {toast && <p className="toast" role="status">{toast}</p>}
    </>
  );
}
