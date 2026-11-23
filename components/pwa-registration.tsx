'use client';

import {useEffect} from 'react';
import {ArrowDown, ArrowUpRight, Share, SquarePlus} from 'lucide-react';
import './pwa-registration.css';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.GITHUB_PAGES === 'true' ? '/wsj' : '');
let registration: Promise<ServiceWorkerRegistration> | undefined;


export function registerWorker() {
  registration ??= navigator.serviceWorker.register(`${base}/sw.js`, {scope: `${base}/`, updateViaCache: 'none'}).catch(error => {
    registration = undefined;
    throw error;
  });
  return registration;
}

export function AppleInstallInstructions() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const safari = !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA/i.test(ua) && /Safari/i.test(ua);
  const tablet = /iPad|Macintosh/i.test(ua);
  return <div className="wsj-install-instructions">
    <p>{safari ? <>Tap <Share size={16} aria-hidden="true"/> <strong>Share</strong>{tablet ? ' near the top right' : ' in Safari’s toolbar'}, then <SquarePlus size={16} aria-hidden="true"/> <strong>Add to Home Screen</strong>.</> : <>Open your browser’s share menu and select <SquarePlus size={16} aria-hidden="true"/> <strong>Add to Home Screen</strong>. If it isn’t listed, open this page in Safari and try again.</>}</p>
    {safari && <span className="wsj-install-arrow" aria-hidden="true">{tablet ? <ArrowUpRight size={20}/> : <ArrowDown size={20}/>}</span>}
  </div>;
}

export function PwaRegistration() {
  // Registers the worker only. The floating install banner was removed at the owner's request.
  useEffect(() => {
    if (window.isSecureContext && 'serviceWorker' in navigator) void registerWorker().catch(() => undefined);
  }, []);
  return null;
}
