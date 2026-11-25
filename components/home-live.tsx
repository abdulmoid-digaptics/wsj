'use client';
import {PODCAST_FORMATS, PODCAST_HOURS, podcastPlanSlug} from '@/lib/podcast-packages';

import Image from '@/components/consistent-image';
import {useEffect, useMemo, useState, useRef} from 'react';
import {ArrowUpRight, ArrowRight, ArrowLeft, Pause, Play} from 'lucide-react';
import {useReducedMotion} from '@/lib/use-reduced-motion';
import {BookingButton} from './booking';

/* Content in this file is taken from the live workspacejunction.com homepage (Oct 2026). */

const SLIDES = [
  {
    src: '/media/dfcf491571-image.png',
    alt: 'Four professionals meeting around a table at Workspace Junction',
    badge: 'Executive Suites & Private Boardrooms',
    title: 'Where Leaders Work.',
    sub: 'Your premier business headquarters in Oakbrook Terrace — from executive boardroom strategy sessions to high-impact broadcasts.',
    tags: ['24/7 Access Option', 'Curated Member Network', 'Private Phone Booths'],
    ctaService: 'Meeting rooms',
    ctaLabel: 'Book a Private Tour',
  },
  {
    src: '/media/ec32287da6-slide-2.png',
    alt: 'Two hosts recording in the Chicagoland Podcast Studio',
    badge: 'Broadcasting & Creative Media',
    title: 'Cowork. Meet. Create.',
    sub: 'Work smarter, connect deeper, and produce bigger. Dedicated creator studios with broadcast-grade acoustics and multi-cam video.',
    tags: ['Acoustic Isolation', 'Shure SM7B Setup', 'Auto-Tracking 4K'],
    ctaService: 'Podcast studio',
    ctaLabel: 'Reserve Studio Time',
  },
  {
    src: '/media/48d393a566-slide-3.png',
    alt: 'Panel podcast recording with four guests around a studio table',
    badge: 'Dynamic Community & Events',
    title: 'Power Meets Purpose.',
    sub: 'Where visionaries convene. Flexible coworking desks, masterclasses, and executive networks built for measurable momentum.',
    tags: ['24/7 Access Option', 'Curated Member Network', 'Private Phone Booths'],
    ctaService: 'Coworking',
    ctaLabel: 'Explore Memberships',
  },
];

export function HeroSlides() {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  // Slides 2-3 are fetched only after the first slide (the LCP image) has had the network.
  const [warm, setWarm] = useState(false);
  const reduced = useReducedMotion();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const swipeRef = useRef<{x: number; y: number} | null>(null);
  const autoplay = !paused && !reduced;

  useEffect(() => {
    const t = window.setTimeout(() => setWarm(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!autoplay || hovered || focused) return;
    timerRef.current = setInterval(() => {
      if (!document.hidden) setIndex(i => (i + 1) % SLIDES.length);
    }, 7000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoplay, hovered, focused]);

  const go = (next: number) => {setWarm(true); setIndex((next + SLIDES.length) % SLIDES.length);};
  const slide = SLIDES[index];

  return (
    <div
      className="lv-hero-stage"
      role="region"
      aria-roledescription="carousel"
      aria-label="Workspace highlights"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onPointerDown={event => {
        if (event.pointerType !== 'mouse') swipeRef.current = {x: event.clientX, y: event.clientY};
      }}
      onPointerUp={event => {
        const start = swipeRef.current;
        swipeRef.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        // Horizontal swipes only; vertical drags keep scrolling the page.
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.5) go(index + (dx < 0 ? 1 : -1));
      }}
      onPointerCancel={() => {swipeRef.current = null;}}
    >
      <div className="lv-hero-copy">
        <div className="lv-hero-content-wrap">
          <p className="lv-hero-badge">{slide.badge}</p>
          <h1 id="hp-title" className="lv-h1">{slide.title}</h1>
          <p className="lv-hero-sub">{slide.sub}</p>
          <div className="lv-hero-tags" aria-label="Key features">
            {slide.tags.map(tag => (
              <span key={tag} className="lv-hero-tag">• {tag}</span>
            ))}
          </div>
          <div className="lv-hero-actions">
            <BookingButton className="btn btn-primary lv-pill lv-hero-primary-cta" service={slide.ctaService}>
              {slide.ctaLabel} <ArrowUpRight size={17} aria-hidden="true" />
            </BookingButton>
            <a className="lv-pill lv-pill-ghost lv-hero-secondary-cta" href="#home-pricing">
              Plans &amp; Pricing <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          </div>
          <p className="lv-hero-location">Oakbrook Terrace, IL <span>·</span> 24/7 Access</p>
        </div>
      </div>
      <div className="lv-hero-media">
        {SLIDES.map((s, i) => (
          <figure key={s.src} className={'lv-slide' + (i === index ? ' is-active' : '')} aria-hidden={i !== index}>
            {(i === 0 || warm || i === index) && <Image src={s.src} alt={s.alt} fill preload={i === 0} fetchPriority={i === 0 ? 'high' : 'low'} sizes="(max-width: 767px) 100vw, 50vw" className="lv-slide-img" />}
          </figure>
        ))}
      </div>
      <div className="lv-hero-bottom-bar">
        <span className="lv-hero-motto">WORK. CONNECT. GROW.</span>
        <p>Flexible spaces for every way of working.</p>
        <div className="lv-controls-cluster">
          {/* Announce slide changes only when the user drives them, never on autoplay. */}
          <span aria-live={autoplay ? 'off' : 'polite'} aria-atomic="true">
            <span className="sr-only">Slide </span>{String(index + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
          </span>
          <div className="lv-slide-dots" role="group" aria-label="Choose slide">
            {SLIDES.map((s, i) => (
              <button key={s.src} type="button" className="lv-slide-dot" aria-label={`Show slide ${i + 1}: ${s.title}`} aria-current={i === index ? 'true' : undefined} onClick={() => go(i)}><span aria-hidden="true"/></button>
            ))}
          </div>
          <button type="button" className="lv-nav-arrow" aria-label="Previous slide" onClick={() => go(index - 1)}>
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className="lv-nav-arrow" aria-label="Next slide" onClick={() => go(index + 1)}>
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          {!reduced && (
            <button type="button" className="lv-nav-arrow lv-autoplay-toggle" aria-pressed={paused} aria-label={paused ? 'Play slideshow' : 'Pause slideshow'} onClick={() => setPaused(p => !p)}>
              {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Group fixed-duration packages by stable checkout IDs. Prices are totals, not hourly rates. */
export interface StudioRate {
  slug: string;
  capacityText: string | null;
  unitAmountCents: number;
  currency: string;
  durationMinutes: number | null;
}

export function studiosFromCatalog(rates: StudioRate[]) {
  const bySlug = new Map(rates.map(rate => [rate.slug, rate]));
  return PODCAST_FORMATS.map(format => {
    const tiers = PODCAST_HOURS.flatMap(hours => {
      const rate = bySlug.get(podcastPlanSlug(format.key, hours));
      if (!rate || rate.durationMinutes !== hours * 60) return [];
      return [{hours, name: `${hours} ${hours === 1 ? 'hour' : 'hours'}`, price: new Intl.NumberFormat('en-US', {style: 'currency', currency: rate.currency, maximumFractionDigits: rate.unitAmountCents % 100 ? 2 : 0}).format(rate.unitAmountCents / 100), planSlug: rate.slug}];
    });
    return {name: format.name, capacity: tiers.map(t => bySlug.get(t.planSlug)?.capacityText).find(Boolean), tiers};
  }).filter(group => group.tiers.length);
}
export function StudioTabs({rates = []}: {rates?: StudioRate[]}) {
  const [active, setActive] = useState(0);
  const studios = useMemo(() => studiosFromCatalog(rates), [rates]);
  const studio = studios[active];
  if (!studio) {
    return (
      <div className="st st-empty">
        <p>Studio sessions are confirmed by our team. Ask us about availability and current session rates.</p>
      </div>
    );
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const n = studios.length;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (active + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    setActive(next);
    document.getElementById(`st-tab-${next}`)?.focus();
  };
  return (
    <div className="st">
      <div className="st-studios" role="tablist" aria-label="Podcast studios" onKeyDown={onKey}>
        {studios.map((s, i) => (
          <button
            key={s.name}
            id={`st-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls="st-panel"
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className="st-studio wj-control"
          >
            <span className="st-studio-name">{s.name}</span>
            {s.capacity && <span className="st-studio-cap">{s.capacity}</span>}
          </button>
        ))}
      </div>

      <div id="st-panel" role="tabpanel" tabIndex={0} aria-labelledby={`st-tab-${active}`} className="st-panel" key={studio.name}>
        <ol className="st-tiers">
          {studio.tiers.map(t => (
            <li key={t.planSlug} className={'st-tier st-tier-' + (t.hours - 1)}>
              <div className="st-tier-head">
                <h3 className="j-studio-rate-title">{t.name}</h3>
              </div>
              <p className="st-price"><span>{t.price}</span> <small>/ {t.hours} hour{t.hours === 1 ? '' : 's'}</small></p>
              <BookingButton className="st-book wj-control" service="podcast-studio" plan={t.planSlug}>
                Book {t.name} <ArrowUpRight size={16} aria-hidden="true" />
              </BookingButton>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
