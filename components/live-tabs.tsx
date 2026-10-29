'use client';
import {useId, useState, type KeyboardEvent, type ReactNode} from 'react';

/* Accessible tabs for content captured from Elementor tab widgets. */
export function LiveTabs({tabs}: {tabs: {title: string; content: ReactNode}[]}) {
  const [active, setActive] = useState(0);
  const base = useId();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (active + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    setActive(next);
    document.getElementById(`${base}-t${next}`)?.focus();
  };
  return <div className="lx-tabs">
    <div className="lv-tabs lx-tablist" role="tablist" onKeyDown={onKey}>
      {tabs.map((t, i) => <button key={i} id={`${base}-t${i}`} type="button" role="tab" aria-selected={i === active} aria-controls={`${base}-p${i}`} tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)}>{t.title}</button>)}
    </div>
    {tabs.map((t, i) => <div key={i} id={`${base}-p${i}`} role="tabpanel" aria-labelledby={`${base}-t${i}`} hidden={i !== active} className="lx-tabpanel">{t.content}</div>)}
  </div>;
}
