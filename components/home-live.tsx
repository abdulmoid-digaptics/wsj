'use client';

import Image from 'next/image';
import {useEffect, useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {BookingButton} from './booking';

/* Content in this file is taken from the live workspacejunction.com homepage (Oct 2026). */

const SLIDES = [
  {src: '/media/3675f6dc28-slide-1.png', alt: 'Team meeting in the Workspace Junction boardroom with a video call on screen', title: 'Where Leaders Work.', sub: 'Your Business HQ — From Boardroom to Broadcast'},
  {src: '/media/ec32287da6-slide-2.png', alt: 'Two hosts recording in the Chicagoland Podcast Studio', title: 'Cowork. Meet. Create', sub: 'Work Smarter — Connect Deeper Create Bigger'},
  {src: '/media/48d393a566-slide-3.png', alt: 'Panel podcast recording with four guests around a studio table', title: 'Power Meets Purpose', sub: 'Where Visionaries Convene'},
];

export function HeroSlides() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (paused || hovered || focused) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const id = window.setInterval(() => {
      if (!media.matches && !document.hidden && document.documentElement.dataset.ambient !== 'paused') {
        setIndex(i => (i + 1) % SLIDES.length);
      }
    }, 6500);
    return () => window.clearInterval(id);
  }, [paused, hovered, focused]);
  return <div className="lv-hero-stage" role="region" aria-roledescription="carousel" aria-label="Workspace highlights" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);}}>
    {SLIDES.map((s, i) => <figure key={s.src} className={'lv-slide' + (i === index ? ' is-active' : '')} aria-hidden={i !== index}>
      <Image src={s.src} alt={s.alt} fill priority={i === 0} sizes="100vw" className="lv-slide-img"/>
    </figure>)}
    <div className="lv-hero-shade" aria-hidden="true"/>
    <div className="lv-hero-copy">
      {/* Keep the sole page heading outside inactive slide content. */}
      <h1 id="hp-title" className="lv-sr">{SLIDES[0].title}</h1>
      <div className="lv-hero-titles" aria-live="off">
        {SLIDES.map((s, i) => <div key={s.title} className={'lv-hero-title' + (i === index ? ' is-active' : '')} aria-hidden={i !== index}>
          <p className="lv-h1" aria-hidden={i === 0 ? true : undefined}>{s.title}</p>
          <p className="lv-hero-sub">{s.sub}</p>
        </div>)}
      </div>
      <div className="lv-hero-actions">
        <BookingButton className="btn btn-primary lv-pill">Book a tour <ArrowUpRight size={18} aria-hidden="true"/></BookingButton>
        <a href="#pricing" className="lv-pill lv-pill-ghost">Plans &amp; Pricing <ArrowUpRight size={18} aria-hidden="true"/></a>
      </div>
      <div className="lv-dots" role="group" aria-label="Choose slide">
        {SLIDES.map((s, i) => <button key={s.title} className="lv-slide-dot" type="button" aria-label={`Show slide ${i + 1}: ${s.title}`} aria-pressed={i === index} onClick={() => {setIndex(i); setPaused(true);}}/>)}
        <button className="lv-slide-pause" type="button" aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'} onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Pause'}</button>
      </div>
    </div>
  </div>;
}

type Tier = {name: string; duration: string; includes: string[]; price: string};
type Studio = {name: string; blurb: string; capacity: string; tiers: Tier[]};
export const STUDIOS: Studio[] = [
  {name: 'Solo Creator Studio', blurb: 'Perfect for solo podcasters, content creators, and short-form recordings.', capacity: '1–2 people', tiers: [
    {name: 'Starter Podcast Session', duration: '1 Hour', includes: ['Professional microphone', '1 camera video recording', 'Studio lighting', 'Audio recording', 'Raw audio and video files'], price: '$75/hour'},
    {name: 'Standard Podcast Session', duration: '2 Hour', includes: ['1 camera video recording', 'Professional audio recording', 'Studio lighting', 'Raw audio and video files'], price: '$140 for 2 hours'},
    {name: 'Premium Podcast Production', duration: '3 Hour', includes: ['Audio cleanup', '1 edited video episode', 'Social media clip (1 highlight)'], price: '$260 for 3 hours'},
  ]},
  {name: 'Interview Studio', blurb: 'Ideal for interview-style podcasts and two-host shows.', capacity: '2–3 people', tiers: [
    {name: 'Starter Podcast Session', duration: '1 Hour', includes: ['2 Professional microphone', '2 camera video recording', 'Studio lighting', 'Audio recording'], price: '$95/hour'},
    {name: 'Standard Podcast Session', duration: '2 Hour', includes: ['Multi-camera recording', 'Professional audio recording', 'Studio lighting', 'Raw audio and video files'], price: '$180/hour'},
    {name: 'Premium Podcast Production', duration: '3 Hour', includes: ['Audio cleanup', '1 edited video episode', 'Social media clip (1 highlight)', 'Multi-camera recording'], price: '$320/hour'},
  ]},
  {name: 'Panel Podcast Studio', blurb: 'Designed for multi-host podcasts and panel discussions.', capacity: 'Up to 4 people', tiers: [
    {name: 'Starter Podcast Session', duration: '1 Hour', includes: ['3–4 microphones', 'Multi-camera recording', 'Studio lighting', 'Audio recording'], price: '$120/hour'},
    {name: 'Standard Podcast Session', duration: '2 Hour', includes: ['Multi-camera production', 'Professional audio mixing', 'Raw audio and video files'], price: '$220/hour'},
    {name: 'Premium Podcast Production', duration: '3 Hour', includes: ['Audio cleanup', '1 edited podcast episode', 'Social media clip (1 highlight)', 'Multi-camera recording'], price: '$380/hour'},
  ]},
  {name: 'Premium Video Podcast Studio', blurb: 'Our flagship studio for high-end video podcasts and professional shows.', capacity: 'Up to 4–5 people', tiers: [
    {name: 'Starter Podcast Session', duration: '1 Hour', includes: ['Professional podcast microphones', '3 camera video production', 'Professional lighting setup', 'Studio operator'], price: '$150/hour'},
    {name: 'Standard Podcast Session', duration: '2 Hour', includes: ['Multi-camera production', 'Audio recording and mixing', 'Professional lighting setup', 'Raw files included'], price: '$280/hour'},
    {name: 'Premium Podcast Production', duration: '3 Hour', includes: ['Full multi-camera production', 'Audio mastering', '1 fully edited episode', '3 Social media clip'], price: '$480/hour'},
  ]},
];

export function StudioTabs() {
  const [active, setActive] = useState(0);
  const studio = STUDIOS[active];
  const onKey = (e: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? STUDIOS.length - 1 : (active + (e.key === 'ArrowRight' ? 1 : STUDIOS.length - 1)) % STUDIOS.length;
    setActive(next);
    document.getElementById(`lv-studio-tab-${next}`)?.focus();
  };
  return <div className="lv-studios">
    <div className="lv-tabs" role="tablist" aria-label="Podcast studios" onKeyDown={onKey}>
      {STUDIOS.map((s, i) => <button key={s.name} id={`lv-studio-tab-${i}`} role="tab" type="button" aria-selected={i === active} aria-controls="lv-studio-panel" tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)}>{s.name}</button>)}
    </div>
    <div id="lv-studio-panel" role="tabpanel" tabIndex={0} aria-labelledby={`lv-studio-tab-${active}`} className="lv-studio-panel" key={studio.name}>
      <div className="lv-studio-head"><h3>{studio.name}</h3><p>{studio.blurb} <strong>Capacity: {studio.capacity}</strong></p></div>
      <div className="lv-tier-grid">
        {studio.tiers.map((t, i) => <article key={t.name} className={'lv-tier' + (i === 1 ? ' is-mid' : '')}>
          {i === 1 && <Image src="/media/aa00b61c5b-value.png" alt="Best value for your money" width={84} height={84} className="lv-value"/>}
          <h4>{t.name}</h4>
          <p className="lv-tier-dur">Duration: {t.duration}</p>
          <p className="lv-tier-inc">Includes:</p>
          <ul>{t.includes.map(x => <li key={x}>{x}</li>)}</ul>
          <BookingButton className="btn btn-primary lv-pill lv-tier-cta" service={`${studio.name}: ${t.name}`}>{t.price}</BookingButton>
        </article>)}
      </div>
    </div>
  </div>;
}
