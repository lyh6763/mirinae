import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Engine } from '../engine/Engine';
import { LIFE_LABEL } from '../gen/system';
import { lightYears, num } from './format';
import { logStore, relativeTime, type LogEntry } from './log';

type Filter = 'all' | 'starred' | 'life' | 'civ';

const FILTERS: [Filter, string][] = [
  ['all', '전체'],
  ['starred', '즐겨찾기'],
  ['life', '생명'],
  ['civ', '문명'],
];

const EMPTY_TEXT: Record<Filter, string> = {
  all: '아직 다녀간 곳이 없습니다. 별을 골라 항성계로 들어가면 여기에 저절로 적힙니다.',
  starred: '즐겨찾기한 곳이 없습니다. 기록 옆의 별 단추로 표시해 두세요.',
  life: '생명을 찾은 곳이 아직 없습니다. 초록 띠(거주 가능 구역) 안의 행성을 살펴보세요.',
  civ: '아직 문명과 마주치지 않았습니다. 은하 개요의 문명 신호 목록이 길잡이가 됩니다.',
};

interface Props {
  open: boolean;
  onClose: () => void;
  engine: Engine;
  busy: boolean;
}

/** 탐사 일지. 네이티브 <dialog>의 모달로 열어 초점 가두기와 Esc 닫기를 브라우저에 맡긴다. */
export function LogDialog({ open, onClose, engine, busy }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const data = useSyncExternalStore(logStore.subscribe, logStore.getSnapshot);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const stats = useMemo(() => {
    const planets = data.entries.filter((e) => e.planet !== null);
    return {
      systems: data.entries.length - planets.length,
      planets: planets.length,
      living: planets.filter((e) => e.life > 0).length,
      civ: planets.filter((e) => e.life === 3).length,
    };
  }, [data]);

  const list = useMemo(() => {
    const keep = (e: LogEntry) =>
      filter === 'all' ? true : filter === 'starred' ? e.starred : filter === 'life' ? e.life > 0 : e.life === 3;
    return data.entries.filter(keep).sort((a, b) => b.last - a.last);
  }, [data, filter]);

  const go = (e: LogEntry) => {
    onClose();
    void engine.jump({ galaxy: e.galaxy, star: e.star, planet: e.planet, mode: e.planet === null ? 'system' : 'planet' });
  };

  const clear = () => {
    if (window.confirm('탐사 일지를 모두 지울까요? 되돌릴 수 없습니다.')) logStore.clear();
  };

  return (
    <dialog ref={ref} className="log" aria-labelledby="log-title" onClose={onClose}>
      <div className="log__head">
        <h2 id="log-title" className="log__title">탐사 일지</h2>
        <button type="button" className="btn btn--small" onClick={onClose}>닫기</button>
      </div>

      <dl className="stats stats--log">
        <div><dt>항성계</dt><dd>{num(stats.systems)}</dd></div>
        <div><dt>행성</dt><dd>{num(stats.planets)}</dd></div>
        <div><dt>생명</dt><dd>{num(stats.living)}</dd></div>
        <div><dt>문명 접촉</dt><dd className="civ">{num(stats.civ)}</dd></div>
      </dl>
      <p className="hint">
        워프 {num(data.warps)}회 · 누적 {lightYears(data.warpLy)}. 기록은 이 브라우저에만 저장됩니다.
      </p>

      <div className="filters" role="group" aria-label="기록 거르기">
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" className="filter" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="hint log__empty">{EMPTY_TEXT[filter]}</p>
      ) : (
        <ul className="log__list">
          {list.map((e) => (
            <LogItem key={e.key} entry={e} onGo={() => go(e)} busy={busy} />
          ))}
        </ul>
      )}

      {data.entries.length > 0 && (
        <div className="log__foot">
          <button type="button" className="btn btn--small btn--danger" onClick={clear}>일지 비우기</button>
        </div>
      )}
    </dialog>
  );
}

function LogItem({ entry, onGo, busy }: { entry: LogEntry; onGo: () => void; busy: boolean }) {
  return (
    <li className="log-item">
      <div className="log-item__head">
        <span className="log-item__kind">{entry.planet === null ? '항성계' : '행성'}</span>
        <span className="log-item__name">{entry.name}</span>
        {entry.life > 0 && (
          <span className={`badge ${entry.life === 3 ? 'badge--civ' : 'badge--life'}`}>{LIFE_LABEL[entry.life]}</span>
        )}
        <button type="button" className="star-toggle" aria-pressed={entry.starred} onClick={() => logStore.toggleStar(entry.key)}>
          {/* 별 기호는 글자가 아니므로 숨기고, 이름은 글자로 준다(보이는 레이블과 접근 이름이 어긋나지 않게). */}
          <span aria-hidden="true">{entry.starred ? '★' : '☆'}</span>
          <span className="sr-only">{entry.name} 즐겨찾기</span>
        </button>
      </div>
      <p className="log-item__meta">
        {entry.detail} · 은하 {entry.galaxy} · {relativeTime(entry.last)} · {entry.visits}번 방문
      </p>
      <label className="log-item__note">
        <span className="field-label">메모<span className="sr-only"> — {entry.name}</span></span>
        <textarea
          className="input"
          rows={2}
          maxLength={500}
          value={entry.note}
          onChange={(ev) => logStore.setNote(entry.key, ev.target.value)}
        />
      </label>
      <div className="log-item__actions">
        <button type="button" className="btn btn--small" onClick={onGo} disabled={busy}>다시 가기</button>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => logStore.remove(entry.key)}>
          지우기<span className="sr-only"> — {entry.name}</span>
        </button>
      </div>
    </li>
  );
}
