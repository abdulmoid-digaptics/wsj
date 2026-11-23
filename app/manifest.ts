import type {MetadataRoute} from 'next';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? (process.env.GITHUB_PAGES === 'true' ? '/wsj' : '');
const icon = {src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png'};

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${base}/`,
    name: 'Workspace Junction',
    short_name: 'WSJ',
    description: 'Coworking, meeting rooms, creative studios and business services in Oakbrook Terrace, Illinois.',
    scope: `${base}/`,
    start_url: `${base}/?source=pwa`,
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#FFFFFF',
    orientation: 'any',
    icons: [
      {...icon, purpose: 'any'},
      {src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any'},
      {src: `${base}/icons/icon-512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable'},
    ],
    shortcuts: [
      {name: 'My Bookings', url: `${base}/account/bookings/`, icons: [icon]},
      {name: 'Book a Space', url: `${base}/meeting-rooms/`, icons: [icon]},
      // The admin application uses the view query to open the named pane.
      {name: 'Admin Inbox', url: `${base}/admin/?view=inquiries#inquiries`, icons: [icon]},
    ],
  };
}
