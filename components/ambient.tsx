'use client';

import {useEffect, useSyncExternalStore} from 'react';
import {Pause, Play} from 'lucide-react';

/*
  Ambient motion system (classic theme).
  - <AmbientBackdrop/>: one fixed, decorative, non-interactive layer behind all
    public content: drifting champagne light, flowing contour lines and a few
    floating outline shapes. CSS transform/opacity loops only (see classic.css).
  - <MotionController/>: pauses section-level ambient layers when offscreen,
    mirrors tab visibility and adds pointer tilt to cards. Scroll choreography
    lives in gsap-motion.tsx.
  - <MotionToggle/>: accessible pause/resume for ongoing decorative animation,
    persisted in localStorage. Hidden when prefers-reduced-motion is set, where
    the CSS already renders a static composition.
*/

const STORAGE_KEY = 'wj-ambient';

/* A smooth wave whose shape repeats every 600 units (tangents match at joins),
   so translating a 2400-wide copy by -50% loops with no visible seam. */
function wave(y:number, amp:number, width = 2400, period = 600) {
  const q = period / 3;
  let d = `M0 ${y}`;
  for (let x = 0; x < width; x += period) d += ` C${x + q} ${y - amp} ${x + 2 * q} ${y + amp} ${x + period} ${y}`;
  return d;
}
const LINES_A = [420, 452, 484].map((y, i) => wave(y, 46 + i * 8));
const LINES_B = [160, 198].map((y, i) => wave(y, -52 - i * 10));

export function AmbientBackdrop() {
  return <div className="amb-backdrop" aria-hidden="true">
    <span className="amb-glow amb-glow-a"/>
    <span className="amb-glow amb-glow-b"/>
    <span className="amb-glow amb-glow-c"/>
    <svg className="amb-lines amb-lines-a" viewBox="0 0 2400 600" preserveAspectRatio="none" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">{LINES_A.map(d => <path key={d} d={d}/>)}</g>
    </svg>
    <svg className="amb-lines amb-lines-b" viewBox="0 0 2400 600" preserveAspectRatio="none" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">{LINES_B.map(d => <path key={d} d={d}/>)}</g>
    </svg>
    <span className="amb-shape amb-ring"/>
    <span className="amb-shape amb-diamond"/>
    <span className="amb-shape amb-circle"/>
    <span className="amb-shape amb-arc"/>
    <span className="amb-shape amb-diamond amb-diamond-sm"/>
  </div>;
}

/* Pause preference lives in localStorage; read it as an external store so
   server and client render agree and no effect-driven setState is needed. */
const PAUSE_EVENT = 'wj:ambient-change';
function readPaused() {try {return localStorage.getItem(STORAGE_KEY) === 'paused';} catch {return false;}}
function subscribePaused(onChange: () => void) {
  window.addEventListener(PAUSE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {window.removeEventListener(PAUSE_EVENT, onChange); window.removeEventListener('storage', onChange);};
}

export function MotionToggle() {
  const paused = useSyncExternalStore(subscribePaused, readPaused, () => false);
  useEffect(() => {
    const root = document.documentElement;
    if (paused) root.dataset.ambient = 'paused'; else delete root.dataset.ambient;
  }, [paused]);
  const toggle = () => {
    try {if (paused) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, 'paused');} catch {}
    window.dispatchEvent(new Event(PAUSE_EVENT));
  };
  return <button type="button" className="amb-toggle" aria-pressed={paused} onClick={toggle} title={paused ? 'Resume background animation' : 'Pause background animation'}>
    {paused ? <Play size={16} aria-hidden="true"/> : <Pause size={16} aria-hidden="true"/>}
    <span className="amb-toggle-label">Pause background animation</span>
  </button>;
}

export function MotionController() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onVisibility = () => {root.dataset.tab = document.hidden ? 'hidden' : 'visible';};
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);

    // Section-level ambient layers only animate while on screen.
    const locals = Array.from(document.querySelectorAll<HTMLElement>('.amb-local'));
    const localIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      for (const entry of entries) (entry.target as HTMLElement).dataset.inview = entry.isIntersecting ? 'true' : 'false';
    }, {rootMargin: '80px 0px'}) : null;
    locals.forEach(el => {el.dataset.inview = 'false'; localIO?.observe(el);});

    // 3D tilt + light sheen on cards, fine pointers only.
    const tiltOff: Array<() => void> = [];
    if (!reduced.matches && window.matchMedia('(pointer: fine)').matches) {
      document.querySelectorAll<HTMLElement>('.wj-platform :is(.hp-service-card,.price-card,.ip-service-card,.ip-feature-card,.hp-journal-card,.journal-card,.directory-card)').forEach(card => {
        card.dataset.tilt = '';
        let raf = 0;
        const move = (e: PointerEvent) => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            const r = card.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
            card.style.setProperty('--ty', `${((px - 0.5) * 7).toFixed(2)}deg`);
            card.style.setProperty('--tx', `${((0.5 - py) * 6).toFixed(2)}deg`);
            card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
            card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
          });
        };
        const leave = () => {cancelAnimationFrame(raf); ['--tx', '--ty'].forEach(p => card.style.removeProperty(p));};
        card.addEventListener('pointermove', move);
        card.addEventListener('pointerleave', leave);
        tiltOff.push(() => {card.removeEventListener('pointermove', move); card.removeEventListener('pointerleave', leave); delete card.dataset.tilt;});
      });
    }
    return () => {
      tiltOff.forEach(off => off());
      document.removeEventListener('visibilitychange', onVisibility);
      localIO?.disconnect();
    };
  }, []);
  return null;
}
