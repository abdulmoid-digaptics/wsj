/**
 * Base URL for browser-side API calls.
 * Defaults to the same-origin `/api` path, which next.config.ts rewrites to API_URL,
 * so the browser never depends on cross-origin CORS to reach the API. Static exports
 * (no rewrites) must set NEXT_PUBLIC_API_URL to the public API origin.
 */
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

/**
 * Browser API URL with a trailing slash before any query string. The site uses
 * `trailingSlash: true`, so `/api/x` would first receive a 308 to `/api/x/`: an extra
 * round trip, and a hard failure for requests made with `redirect: 'error'`.
 */
export function apiUrl(path: string, base: string = PUBLIC_API_URL): string {
  const cut = path.search(/[?#]/);
  const pathname = cut < 0 ? path : path.slice(0, cut);
  const rest = cut < 0 ? '' : path.slice(cut);
  return base + (pathname.endsWith('/') ? pathname : pathname + '/') + rest;
}
