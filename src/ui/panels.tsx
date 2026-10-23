import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Engine, EngineState, SearchHit } from '../engine/Engine';
import { LIFE_LABEL, PLANET_TYPE_LABEL, type Planet, type StarSystem } from '../gen/system';
import {
  age, atmosphere, au, describeHole, describePlanet, kindLabel, lightYears, man, num, period, pressure, ro, tempC, times,
  TYPE_COLOR,
} from './format';

interface PanelProps {
  state: EngineState;
  engine: Engine;
}

export function Panel({ state, engine }: PanelProps) {
  if (state.flight && state.system && state.selectedPlanet !== null) {
    return <FlightPanel state={state} engine={engine} system={state.system} index={state.selectedPlanet} />;
  }
  if (state.mode === 'planet' && state.system && state.selectedPlanet !== null) {
    return <PlanetPanel state={state} engine={engine} system={state.system} index={state.selectedPlanet} />;
  }
  if (state.mode === 'system' && state.system) return <SystemPanel state={state} engine={engine} system={state.system} />;
  if (state.system) return <StarPanel state={state} engine={engine} system={state.system} />;
  return <GalaxyPanel state={state} engine={engine} />;
}

function Title({ children }: { children: string }) {
  return (
    <h2 id="panel-title" className="title" tabIndex={-1}>
      {children}
    </h2>
  );
}

function PlanetDot({ planet, size = 12 }: { planet: Planet; size?: number }) {
  const d = Math.round(size * (0.6 + Math.min(Math.sqrt(planet.radiusEarth) / 3.6, 0.9)));
  return <span className="pdot" aria-hidden="true" style={{ width: d, height: d, background: TYPE_COLOR[planet.type] }} />;
}

function LifeBadge({ planet }: { planet: Planet }) {
  if (planet.life === 0) return null;
  return <span className={`badge ${planet.life === 3 ? 'badge--civ' : 'badge--life'}`}>{LIFE_LABEL[planet.life]}</span>;
}

// ── 은하 개요 ────────────────────────────────────────────────────────────────
function GalaxyPanel({ state, engine }: PanelProps) {
  const { scan } = state;
  const pct = scan.total ? Math.floor((scan.done / scan.total) * 100) : 0;
  const shown = scan.signals.slice(0, 40);
  return (
    <section className="panel__body">
      <p className="eyebrow">은하</p>
      <Title>{state.galaxyName}</Title>
      <p className="lede">
        나선팔 {state.arms}개에 별 {num(state.starCount)}개. 별 하나하나가 행성을 거느린 항성계이고, 이름만 같으면 누가 열어도
        같은 은하가 만들어집니다.
      </p>

      <div className="scan">
        <div className="scan__head">
          <span>{pct < 100 ? '항성계 탐색 중' : '탐색 완료'}</span>
          <span className="mono">{pct}%</span>
        </div>
        <div className="scan__bar" role="progressbar" aria-label="은하 탐색 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <dl className="stats">
          <div><dt>행성</dt><dd>{man(scan.planets)}</dd></div>
          <div><dt>생명</dt><dd>{num(scan.living)}곳</dd></div>
          <div><dt>문명 신호</dt><dd className="civ">{num(scan.signals.length)}건</dd></div>
          <div><dt>쌍성계</dt><dd>{man(scan.binaries)}</dd></div>
          <div><dt>블랙홀</dt><dd className="hole">{num(scan.holes.length)}개</dd></div>
        </dl>
      </div>

      <button type="button" className="btn btn--wide btn--hole" onClick={() => engine.selectStar(0)} disabled={state.busy}>
        은하 중심 블랙홀 찾아가기
      </button>

      <StarSearch engine={engine} scanned={scan.done} />

      <button type="button" className="btn btn--wide" onClick={() => engine.randomStar()} disabled={state.busy}>
        아무 별로 가 보기
      </button>

      <h3 className="h3">문명 신호</h3>
      {shown.length === 0 ? (
        <p className="hint">{pct < 100 ? '신호를 찾는 중입니다…' : '이 은하에서는 문명 신호가 잡히지 않았습니다.'}</p>
      ) : (
        <ul className="signals">
          {shown.map((s) => (
            <li key={`${s.star}-${s.planet}`}>
              <button type="button" onClick={() => engine.selectStar(s.star)} disabled={state.busy}>
                <span className="signal-dot" aria-hidden="true" />
                <span className="signals__name">{s.planetName}</span>
                <span className="signals__what">{s.signal}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {scan.signals.length > shown.length && <p className="hint">외 {num(scan.signals.length - shown.length)}건. 별 이름으로 찾아보세요.</p>}

      {scan.holes.length > 1 && (
        <>
          <h3 className="h3">항성 블랙홀</h3>
          <ul className="signals">
            {scan.holes.slice(1, 13).map((h) => (
              <li key={h.star}>
                <button type="button" onClick={() => engine.selectStar(h.star)} disabled={state.busy}>
                  <span className="signal-dot signal-dot--hole" aria-hidden="true" />
                  <span className="signals__name">{h.name}</span>
                  <span className="signals__what">#{h.star}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <SeedForm engine={engine} current={state.galaxyName} busy={state.busy} />
    </section>
  );
}

function StarSearch({ engine, scanned }: { engine: Engine; scanned: number }) {
  const [query, setQuery] = useState('');
  // 탐색이 진행되면 찾을 수 있는 별이 늘어나므로 scanned도 의존성에 넣는다.
  const hits: SearchHit[] = useMemo(() => engine.search(query), [engine, query, scanned]);
  return (
    <div className="search">
      <label htmlFor="star-search" className="field-label">별 이름으로 찾기</label>
      <input
        id="star-search"
        className="input"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-describedby="star-search-help"
      />
      <p id="star-search-help" className="hint">
        한글 이름 일부를 넣으세요. 지금까지 탐색한 {num(scanned)}개 별에서 찾습니다.
      </p>
      {query.trim() && (
        <>
          <p className="sr-only" aria-live="polite">검색 결과 {hits.length}개</p>
          {hits.length === 0 ? (
            <p className="hint">그런 이름의 별이 아직 없습니다.</p>
          ) : (
            <ul className="results">
              {hits.map((h) => (
                <li key={h.index}>
                  <button type="button" onClick={() => engine.selectStar(h.index)}>
                    <span>{h.name}</span>
                    <span className="mono muted">{h.cls}형 · #{h.index}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SeedForm({ engine, current, busy }: { engine: Engine; current: string; busy: boolean }) {
  const [value, setValue] = useState(current);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void engine.setGalaxy(value);
  };
  return (
    <form className="seed" onSubmit={submit}>
      <label htmlFor="galaxy-seed" className="field-label">다른 은하 만들기</label>
      <div className="seed__row">
        <input id="galaxy-seed" className="input" value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} aria-describedby="galaxy-seed-help" />
        <button type="submit" className="btn" disabled={busy || !value.trim() || value.trim() === current}>만들기</button>
      </div>
      <p id="galaxy-seed-help" className="hint">아무 낱말이나 은하의 씨앗이 됩니다. 같은 낱말은 언제나 같은 은하를 만듭니다.</p>
    </form>
  );
}

// ── 가까운 별: 은하 화면에서는 고르기, 항성계에서는 워프 ──────────────────────
function NearbyStars({ engine, state, index, action }: { engine: Engine; state: EngineState; index: number; action: 'select' | 'warp' }) {
  const list = useMemo(() => engine.neighbors(index, 6), [engine, index, state.galaxyName]);
  if (list.length === 0) return null;
  return (
    <>
      <h3 className="h3">가까운 별</h3>
      {action === 'warp' && <p className="hint">고른 별로 은하 화면을 거치지 않고 곧장 날아갑니다.</p>}
      <ul className="nearby">
        {list.map((n) => (
          <li key={n.index}>
            <span className="chip__dot" aria-hidden="true" style={{ background: n.color, boxShadow: `0 0 10px ${n.color}` }} />
            <span className="nearby__text">
              <span className="nearby__name">{n.name}</span>
              <span className="nearby__meta">
                {n.cls}형 · {lightYears(n.distanceLy)} · 행성 {n.planets}개
              </span>
            </span>
            {n.life > 0 && <span className={`badge ${n.life === 3 ? 'badge--civ' : 'badge--life'}`}>{n.life === 3 ? '문명' : '생명'}</span>}
            <button
              type="button"
              className={`btn btn--small ${action === 'warp' ? 'btn--warp' : ''}`}
              disabled={state.busy}
              onClick={() => (action === 'warp' ? void engine.warpTo(n.index) : engine.selectStar(n.index))}
              aria-label={action === 'warp' ? `${ro(n.name)} 워프, ${lightYears(n.distanceLy)}` : `${n.name} 고르기, ${lightYears(n.distanceLy)}`}
            >
              {action === 'warp' ? '워프' : '고르기'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── 고른 별 (은하 화면) ──────────────────────────────────────────────────────
function StarFacts({ system }: { system: StarSystem }) {
  const { star } = system;
  const place = (
    <>
      <dt>구역</dt><dd>{star.sector.quadrant} · {star.sector.mansion}수({star.sector.hanja}宿)</dd>
      <dt>은하 중심에서</dt><dd>{star.kind === 'core' ? '바로 이곳' : lightYears(star.coreDistanceLy)}</dd>
    </>
  );
  if (star.hole) {
    const km = star.hole.horizonKm;
    return (
      <dl className="facts">
        <dt>질량</dt><dd>태양의 {times(star.mass)}</dd>
        <dt>지평선 반지름</dt><dd>{km > 1e6 ? au(km / 1.496e8) : `${num(km)} km`}</dd>
        <dt>원반 온도</dt><dd>{man(star.hole.diskTempK)} K</dd>
        <dt>나이</dt><dd>{age(star.ageGyr)}</dd>
        {place}
      </dl>
    );
  }
  const c = star.companion;
  return (
    <dl className="facts">
      <dt>표면 온도</dt><dd>{num(star.temperatureK)} K</dd>
      <dt>질량</dt><dd>태양의 {times(star.mass)}</dd>
      <dt>반지름</dt><dd>태양의 {times(star.radius)}</dd>
      <dt>밝기</dt><dd>태양의 {times(star.luminosity)}</dd>
      {c && (
        <>
          <dt>동반성</dt><dd>{c.cls}형 · {num(c.temperatureK)} K · 태양의 {times(c.mass)}</dd>
          <dt>두 별 사이</dt><dd>{au(c.separationAU)} · {period(c.periodDays)}마다 한 바퀴</dd>
        </>
      )}
      <dt>나이</dt><dd>{age(star.ageGyr)}</dd>
      {place}
    </dl>
  );
}

function StarChip({ system }: { system: StarSystem }) {
  const { star } = system;
  const dot = (color: string) => (
    <span className="chip__dot" aria-hidden="true" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
  );
  return (
    <p className="chip">
      {star.hole ? <span className="chip__dot chip__dot--hole" aria-hidden="true" /> : dot(star.color)}
      {star.companion && dot(star.companion.color)}
      {kindLabel(star)}
    </p>
  );
}

function StarPanel({ state, engine, system }: PanelProps & { system: StarSystem }) {
  const { star, planets } = system;
  return (
    <section className="panel__body">
      <button type="button" className="back" onClick={() => engine.selectStar(null)} disabled={state.busy}>← 은하 개요</button>
      <p className="eyebrow mono">{star.code}</p>
      <Title>{star.name}</Title>
      <StarChip system={system} />
      <StarFacts system={system} />

      {star.hole && <p className="desc">{describeHole(star, state.galaxyName)}</p>}
      <h3 className="h3">행성 {planets.length}개</h3>
      {planets.length === 0 ? (
        <p className="hint">
          {star.hole ? '블랙홀 곁에는 남아 있는 행성이 없습니다.' : '행성이 없는 외로운 별입니다. 그래도 가까이 가 볼 수 있습니다.'}
        </p>
      ) : (
        <ol className="strip">
          {planets.map((p) => (
            <li key={p.order}>
              <PlanetDot planet={p} />
              <span className="strip__name">{p.name}</span>
              <span className="strip__type">{PLANET_TYPE_LABEL[p.type]}</span>
              <LifeBadge planet={p} />
            </li>
          ))}
        </ol>
      )}

      <button type="button" className="btn btn--primary btn--wide" onClick={() => void engine.enterSystem()} disabled={state.busy}>
        {star.hole ? '블랙홀로 다가가기' : '항성계로 들어가기'}
      </button>
      <p className="hint center">별을 두 번 눌러도 들어갑니다.</p>
      <NearbyStars engine={engine} state={state} index={star.index} action="select" />
    </section>
  );
}

// ── 항성계 ───────────────────────────────────────────────────────────────────
function HolePanel({ state, engine, system }: PanelProps & { system: StarSystem }) {
  const { star } = system;
  return (
    <section className="panel__body">
      <p className="eyebrow">블랙홀 · <span className="mono">{star.code}</span></p>
      <Title>{star.name}</Title>
      <StarChip system={system} />
      <p className="desc">{describeHole(star, state.galaxyName)}</p>
      <p className="hint">
        가운데 검은 원은 빛도 빠져나오지 못하는 그림자입니다. 원반 위아래로 보이는 빛은 원반 뒤쪽이 중력에 휘어 넘어온
        것이고, 둘레의 별빛도 렌즈처럼 일그러집니다. 원반의 한쪽이 더 밝은 것은 그쪽 가스가 우리 쪽으로 달려오기 때문입니다.
      </p>
      <StarFacts system={system} />
      <NearbyStars engine={engine} state={state} index={star.index} action="warp" />
    </section>
  );
}

function SystemPanel({ state, engine, system }: PanelProps & { system: StarSystem }) {
  const { star, planets } = system;
  if (star.hole) return <HolePanel state={state} engine={engine} system={system} />;
  const selected = state.selectedPlanet;
  const picked = selected !== null ? planets[selected] : null;
  return (
    <section className="panel__body">
      <p className="eyebrow">항성계 · <span className="mono">{star.code}</span></p>
      <Title>{star.name}</Title>
      <StarChip system={system} />
      <p className="hint">
        <span className="hz-swatch" aria-hidden="true" /> 초록 띠는 물이 액체로 있을 수 있는 거주 가능 구역입니다
        ({au(star.habitable[0])}~{au(star.habitable[1])}).
      </p>

      <h3 className="h3">행성 {planets.length}개</h3>
      {planets.length === 0 && <p className="hint">이 별은 혼자입니다.</p>}
      <ul className="plist">
        {planets.map((p, i) => (
          <li key={p.order}>
            <button
              type="button"
              aria-pressed={selected === i}
              onClick={() => engine.selectPlanet(selected === i ? null : i)}
              disabled={state.busy}
            >
              <PlanetDot planet={p} size={14} />
              <span className="plist__text">
                <span className="plist__name">{p.name}</span>
                <span className="plist__meta">{PLANET_TYPE_LABEL[p.type]} · {tempC(p.tempC)} · {au(p.orbitAU)}</span>
              </span>
              <span className="plist__badges">
                {p.inHabitableZone && <span className="badge badge--hz">거주 가능 구역</span>}
                <LifeBadge planet={p} />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {picked && (
        <div className="peek">
          <p>{describePlanet(picked, star)}</p>
          <button type="button" className="btn btn--primary btn--wide" onClick={() => void engine.enterPlanet()} disabled={state.busy}>
            {ro(picked.name)} 내려가기
          </button>
        </div>
      )}
      <NearbyStars engine={engine} state={state} index={star.index} action="warp" />
      <h3 className="h3">항성 정보</h3>
      <StarFacts system={system} />
    </section>
  );
}

// ── 저공비행 ─────────────────────────────────────────────────────────────────
function FlightPanel({ state, engine, system, index }: PanelProps & { system: StarSystem; index: number }) {
  const p = system.planets[index];
  const [auto, setAuto] = useState(true);
  const [speed, setSpeed] = useState(34);
  const [clearance, setClearance] = useState(7);
  const [tele, setTele] = useState(engine.flightTelemetry());

  // 계기 값은 매 프레임 바뀌므로 React 상태로는 0.25초마다만 옮긴다.
  useEffect(() => {
    const id = setInterval(() => setTele(engine.flightTelemetry()), 250);
    return () => clearInterval(id);
  }, [engine]);
  useEffect(() => engine.setFlightOptions({ auto, speed, clearance }), [engine, auto, speed, clearance]);

  return (
    <section className="panel__body">
      <p className="eyebrow">저공비행 · {PLANET_TYPE_LABEL[p.type]}</p>
      <Title>{p.name}</Title>
      <dl className="stats stats--flight" aria-label="비행 계기">
        <div><dt>지면 위</dt><dd>{tele ? `${tele.altitudeKm.toFixed(1)}km` : '—'}</dd></div>
        <div><dt>아래 해발</dt><dd>{tele ? (tele.overWater ? '바다' : `${tele.groundKm.toFixed(1)}km`) : '—'}</dd></div>
        <div><dt>방향</dt><dd>{tele ? `${Math.round(tele.heading)}°` : '—'}</dd></div>
      </dl>
      <p className="hint">지형의 높낮이는 알아보기 쉽게 실제보다 약 10배 과장했고, 높이 수치는 그 비율을 되돌려 보여 줍니다.</p>
      <label className="check">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        자동 비행(경치를 따라 천천히 굽이침)
      </label>
      <label className="slider">
        <span className="slider__label">속도</span>
        <input type="range" min={8} max={90} step={1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        <span className="slider__value mono" aria-hidden="true">{speed}</span>
      </label>
      <label className="slider">
        <span className="slider__label">높이</span>
        <input type="range" min={2.5} max={26} step={0.5} value={clearance} onChange={(e) => setClearance(Number(e.target.value))} />
        <span className="slider__value mono" aria-hidden="true">{clearance}</span>
      </label>
      <p className="hint">
        우주 화면에 초점을 두고 ← → 로 방향을, ↑ ↓ 로 높이를 바꿉니다. 화면을 끌어도 조종됩니다. 산이 다가오면 저절로 높이를 올립니다.
      </p>
      <button type="button" className="btn btn--wide" onClick={() => void engine.stopFlight()} disabled={state.busy}>
        비행 끝내고 궤도로
      </button>
    </section>
  );
}

// ── 행성 ─────────────────────────────────────────────────────────────────────
function PlanetPanel({ state, engine, system, index }: PanelProps & { system: StarSystem; index: number }) {
  const { star, planets } = system;
  const p = planets[index];
  const giant = p.type === 'gas' || p.type === 'icegiant';
  const prev = planets[index - 1];
  const next = planets[index + 1];
  return (
    <section className="panel__body">
      <p className="eyebrow">{PLANET_TYPE_LABEL[p.type]} · {star.name}의 {index + 1}번째 행성</p>
      <Title>{p.name}</Title>
      <p className="badges">
        {p.inHabitableZone && <span className="badge badge--hz">거주 가능 구역</span>}
        <LifeBadge planet={p} />
        {p.rings && <span className="badge">고리</span>}
      </p>
      {p.civSignal && (
        <p className="callout">
          <strong>문명 신호 감지</strong>
          {p.civSignal}
        </p>
      )}
      <p className="desc">{describePlanet(p, star)}</p>
      {giant ? (
        <p className="hint">단단한 땅이 없어 저공비행은 할 수 없습니다.</p>
      ) : (
        <button type="button" className="btn btn--primary btn--wide" onClick={() => void engine.startFlight()} disabled={state.busy}>
          저공비행
        </button>
      )}
      <dl className="facts">
        <dt>궤도 반지름</dt><dd>{au(p.orbitAU)}</dd>
        <dt>공전 주기</dt><dd>{period(p.periodDays)}</dd>
        <dt>하루 길이</dt><dd>{p.dayHours === null ? '조석 고정' : `${p.dayHours.toFixed(1)}시간`}</dd>
        <dt>반지름</dt><dd>지구의 {times(p.radiusEarth)}</dd>
        <dt>질량</dt><dd>지구의 {times(p.massEarth)}</dd>
        <dt>{giant ? '구름 꼭대기 중력' : '표면 중력'}</dt><dd>{p.gravity.toFixed(2)} G</dd>
        <dt>평균 기온</dt><dd>{tempC(p.tempC)}</dd>
        <dt>대기</dt><dd>{atmosphere(p)}</dd>
        <dt>기압</dt><dd>{pressure(p)}</dd>
        <dt>바다</dt><dd>{p.ocean > 0.01 ? `표면의 ${Math.round(p.ocean * 100)}%` : '없음'}</dd>
        <dt>위성</dt><dd>{p.moons}개</dd>
        <dt>자전축 기울기</dt><dd>{p.tilt.toFixed(0)}°</dd>
      </dl>
      <div className="pager">
        <button type="button" className="btn" disabled={!prev || state.busy} onClick={() => void engine.switchPlanet(index - 1)}>
          ← {prev ? prev.name : '처음'}
        </button>
        <button type="button" className="btn" disabled={!next || state.busy} onClick={() => void engine.switchPlanet(index + 1)}>
          {next ? next.name : '끝'} →
        </button>
      </div>
      <button type="button" className="btn btn--wide" onClick={() => engine.back()} disabled={state.busy}>
        {star.name} 항성계로 돌아가기
      </button>
    </section>
  );
}
