'use client';
/**
 * Event gallery: a photo mosaic with a full-screen viewer.
 * Click (or Enter) on a photo to open it; arrow keys / buttons move between photos, Esc closes.
 * Focus returns to the photo that opened the viewer.
 */
import Image from 'next/image';
import * as Dialog from '@radix-ui/react-dialog';
import {ChevronLeft, ChevronRight, Expand, X} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import './event-gallery.css';

export type GalleryPhoto = {src: string; alt: string};

export function EventGallery({photos, label = 'Event photos'}: {photos: GalleryPhoto[]; label?: string}) {
  const [open, setOpen] = useState<number | null>(null);
  const openers = useRef<Array<HTMLButtonElement | null>>([]);
  const last = useRef(0);
  const count = photos.length;
  const go = useCallback((step: number) => setOpen(i => (i === null ? i : (i + step + count) % count)), [count]);

  useEffect(() => {
    if (open === null) return;
    last.current = open;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  if (!count) return null;
  const current = open === null ? null : photos[open];

  return (
    <>
      <ul className="eg-grid" aria-label={label} data-count={Math.min(count, 7)}>
        {photos.map((photo, i) => (
          <li key={photo.src + i} className={'eg-item eg-item-' + (i + 1)}>
            <button type="button" className="eg-tile wj-control" ref={el => { openers.current[i] = el; }} onClick={() => setOpen(i)} aria-label={'Open photo ' + (i + 1) + ' of ' + count + ': ' + photo.alt}>
              <Image src={photo.src} alt={photo.alt} fill sizes={i === 0 ? '(max-width: 767px) 100vw, 640px' : '(max-width: 767px) 50vw, 320px'} className="eg-img" />
              <span className="eg-shade" aria-hidden="true" />
              <span className="eg-caption">{photo.alt}</span>
              <span className="eg-zoom" aria-hidden="true"><Expand size={16} /></span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog.Root open={open !== null} onOpenChange={value => { if (!value) setOpen(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="eg-overlay" />
          <Dialog.Content className="eg-viewer" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); openers.current[last.current]?.focus(); }}>
            <Dialog.Title className="eg-sr">{label}</Dialog.Title>
            {current && (
              <figure className="eg-figure">
                <div className="eg-stage">
                  <Image key={current.src} src={current.src} alt={current.alt} fill sizes="100vw" className="eg-stage-img" priority />
                </div>
                <figcaption className="eg-figcaption"><span>{current.alt}</span><span className="eg-count">{(open ?? 0) + 1} / {count}</span></figcaption>
              </figure>
            )}
            {count > 1 && (
              <>
                <button type="button" className="eg-nav eg-prev wj-control" onClick={() => go(-1)} aria-label="Previous photo"><ChevronLeft size={26} /></button>
                <button type="button" className="eg-nav eg-next wj-control" onClick={() => go(1)} aria-label="Next photo"><ChevronRight size={26} /></button>
              </>
            )}
            <Dialog.Close className="eg-close wj-control" aria-label="Close gallery"><X size={22} /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
