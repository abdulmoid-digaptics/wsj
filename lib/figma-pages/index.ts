import type {FigmaPage} from './types';
import {spacesPages} from './spaces';
import {studioPages} from './studios';
import {communityPages} from './community';
import {useCasePages} from './use-cases';
import {blogPages} from './blogs';
import {locationPages} from './locations';

/* Every redesigned Figma page, keyed by its route path (trailing slash).
   Frame → route mapping is documented beside each entry (node id). */
export const FIGMA_PAGES: Readonly<Record<string, FigmaPage>> = {...spacesPages, ...studioPages, ...communityPages, ...useCasePages, ...blogPages, ...locationPages};

/** Routes that exist only as Figma pages (no migrated WordPress entry). */
export const FIGMA_ONLY_PATHS = ['/upcoming-events/', '/use-cases/digital-nomads/', '/areas-we-serve/'];

export function figmaPageFor(path: string): FigmaPage | undefined {
  const key = '/' + path.replace(/^\/+|\/+$/g, '') + '/';
  return FIGMA_PAGES[key];
}

export type {FigmaPage} from './types';
