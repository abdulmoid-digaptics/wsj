import type {NextConfig} from 'next';
import redirects from './data/redirects.json';

const isExport = process.env.GITHUB_PAGES === 'true' || Boolean(process.env.NEXT_PUBLIC_BASE_PATH);
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (isExport ? '/wsj' : '');
const apiUrl = process.env.API_URL || 'http://localhost:4000/api';
const apiOrigin = new URL(apiUrl).origin;
const publicApi = process.env.NEXT_PUBLIC_API_URL?.startsWith('http') ? new URL(process.env.NEXT_PUBLIC_API_URL) : new URL(apiOrigin);
const isDev = process.env.NODE_ENV === 'development';

/*
 * Content-Security-Policy without nonces (see node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md), so static and ISR pages keep rendering statically.
 * Script and frame origins are an explicit allowlist: Stripe checkout, YouTube (no-cookie)
 * and Google Maps embeds. Images allow any HTTPS source because CMS posts reference
 * remote images; they cannot execute code.
 */
const browserApiOrigin = process.env.NEXT_PUBLIC_API_URL?.startsWith('http') ? ' ' + new URL(process.env.NEXT_PUBLIC_API_URL).origin : '';
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com" + (isDev ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  /* Loopback API origins are server-internal: browsers never load them in production. */
  "img-src 'self' data: blob: https:" + (publicApi.protocol === 'http:' && (isDev || !['127.0.0.1', 'localhost', '[::1]'].includes(publicApi.hostname)) ? ' ' + publicApi.origin : ''),
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://api.stripe.com https://maps.googleapis.com" + browserApiOrigin + (isDev ? ' ws: wss:' : ''),
  "frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com https://www.google.com https://maps.google.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const config: NextConfig = {
  ...(isExport ? { output: 'export', basePath } : {}),
  distDir: process.env.NEXT_DIST_DIR || '.next',
  /* Do not advertise the framework and version to scanners. */
  poweredByHeader: false,
  /* experimental.inlineCss was measured on 19 Nov 2026 and rejected: pixel-identical, but it
     inlined 444-688 KB of CSS and grew each HTML page to 1.7-2 MB. Do not re-enable without
     first reducing the global stylesheet size. */
  trailingSlash: true,
  images: isExport
    ? {
        loader: 'custom',
        loaderFile: './lib/image-loader.ts',
      }
    : {
        formats: ['image/avif', 'image/webp'],
        remotePatterns: [
          {
            protocol: publicApi.protocol.replace(':', '') as 'http' | 'https',
            hostname: publicApi.hostname,
            port: publicApi.port,
            pathname: '/uploads/**',
          },
          {
            protocol: 'https',
            hostname: 'chicagolandpodcaststudio.com',
          },
          {
            protocol: 'https',
            hostname: 'pub-e4b4ffee7e0747098f49cc9765932cee.r2.dev',
          },
        ],
      },
  turbopack: { rules: { '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' } } },
  ...(!isExport
    ? {
        async rewrites() {
          return [
            { source: '/api/:path*', destination: apiUrl + '/:path*' },
            { source: '/uploads/:path*', destination: apiOrigin + '/uploads/:path*' },
          ];
        },
        async redirects() {
          return (redirects as { source: string; destination: string }[]).map((r) => ({ ...r, statusCode: 301 }));
        },
        async headers() {
          return [
            { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] },
            {
              source: '/:path*',
              headers: [
                { key: 'X-Content-Type-Options', value: 'nosniff' },
                { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
                { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")' },
                { key: 'Content-Security-Policy', value: contentSecurityPolicy },
                /* Ignored by browsers over plain HTTP; enforced once served over HTTPS. */
                { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
                /* Allows Stripe 3-D Secure popups while isolating this window from other origins. */
                { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
              ],
            },
          ];
        },
      }
    : {}),
};

export default config;
 