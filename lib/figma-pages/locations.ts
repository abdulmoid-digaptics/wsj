import type {FigmaPage} from './types';
import {closing} from './spaces';

/* Local SEO hub. Facts only: the address, hours and map come from lib/seo BUSINESS (mirrors the
   Google Business Profile), guide links point at journal articles that already exist, and no
   distances, drive times or reviews are claimed. Photos are the HD set on Cloudflare R2. */
const R2 = 'https://pub-e4b4ffee7e0747098f49cc9765932cee.r2.dev/site/home/';

export const locationPages: Record<string, FigmaPage> = {
  '/areas-we-serve/': {
    node: 'local-seo',
    title: 'Coworking near Oak Brook, Lombard, Elmhurst & Chicago',
    description: 'Workspace Junction in Oakbrook Terrace serves Oak Brook, Lombard, Villa Park, Elmhurst, Downers Grove and Chicago. Directions, hours and local guides.',
    sections: [
      {kind: 'hero', eyebrow: 'AREAS WE SERVE', title: 'Your Workspace,\nClose to Home.', size: 'xl',
        lead: 'One address in Oakbrook Terrace for coworking, meeting rooms, studios and business services, used by founders, freelancers, creators and teams from across the western Chicago suburbs.',
        chips: [{icon: 'map-pin', label: 'Oakbrook Terrace, IL'}, {icon: 'clock', label: 'Open seven days a week'}, {icon: 'users', label: 'Seven nearby communities'}],
        actions: [{label: 'Get Directions', href: '#visit'}, {label: 'Book a Tour', book: ''}],
        image: {src: R2 + 'coworking-floor-hd.webp', alt: 'Rows of workstations on the Workspace Junction coworking floor'}},
      {kind: 'local', id: 'visit', bg: 'cream', eyebrow: 'VISIT THE JUNCTION', title: 'Find Us on Summit Avenue',
        lead: 'We are in Unit E2, Suite 1 at 1S280 Summit Avenue in Oakbrook Terrace. Open the map for turn-by-turn directions from wherever you are.'},
      {kind: 'areas', id: 'communities', bg: 'white', eyebrow: 'COMMUNITIES WE SERVE', title: 'Workspace for the Western Suburbs',
        lead: 'Members and clients come to us from these nearby communities. Each one links to directions and the local guides we have published.',
        areas: [
          {name: 'Oakbrook Terrace', note: 'Our home base on Summit Avenue, with coworking, private rooms, studios and business services under one roof.', guides: [{label: 'Coworking, studios and mailboxes in Chicagoland', href: '/coworking-space-in-oakbrook-terrace/'}, {label: 'Office space for rent in Oakbrook Terrace', href: '/office-space-for-rent-oakbrook-terrace/'}, {label: 'Virtual mailbox in Oakbrook Terrace', href: '/virtual-mailbox-oakbrook-terrace/'}]},
          {name: 'Oak Brook', note: 'Right next door: book a meeting room or the boardroom, set up a business address, or work from a dedicated desk.', guides: [{label: 'Virtual mailbox services in Oak Brook', href: '/virtual-mailbox-service-oak-brook/'}, {label: 'Mailbox service for Oak Brook and Lombard', href: '/virtual-mailbox-service-oak-brook-lombard/'}]},
          {name: 'Lombard', note: 'For Lombard founders who want a professional address, a room for client meetings or a studio to record in.', guides: [{label: 'Mailbox service for Oak Brook and Lombard', href: '/virtual-mailbox-service-oak-brook-lombard/'}]},
          {name: 'Villa Park', note: 'Use a commercial street address in Oakbrook Terrace for registration, licensing and your website.', guides: [{label: 'Professional business address in the suburbs', href: '/professional-business-address-villa-park/'}]},
          {name: 'Elmhurst', note: 'Coworking, dedicated desks and studios for Elmhurst professionals who want to work closer to home.', guides: [{label: 'Coworking in Chicago and Elmhurst', href: '/best-coworking-space-in-chicago/'}]},
          {name: 'Downers Grove', note: 'Mailbox rental, virtual mailbox and business address services for Downers Grove businesses.', guides: [{label: 'Virtual mailbox near Downers Grove', href: '/virtual-mailbox-downers-grove/'}, {label: 'Mailbox services near Downers Grove', href: '/virtual-mailbox-service-near-downers-grove/'}]},
          {name: 'Chicago', note: 'A western-suburbs alternative to downtown space for Chicago teams, creators and remote workers.', guides: [{label: 'Coworking in Chicagoland', href: '/coworking-space-chicago/'}, {label: 'Podcast studios in Chicago', href: '/podcast-studio-chicago/'}, {label: 'Virtual mailbox in Chicago', href: '/virtual-mailbox-service-chicago/'}, {label: 'Office space in Chicago', href: '/office-spaces-for-rent-in-chicago/'}]},
        ]},
      {kind: 'grid', id: 'book', bg: 'sage', eyebrow: 'WHAT YOU CAN BOOK', title: 'Everything at One Address', split: true, cols: 4, variant: 'card',
        lead: 'Every service below is available at our Oakbrook Terrace location and can be booked online.',
        items: [
          {icon: 'users', title: 'Coworking', text: 'Flexible monthly plans', href: '/coworking/'},
          {icon: 'monitor', title: 'Dedicated Desks', text: 'A desk that stays yours', href: '/dedicated/'},
          {icon: 'presentation', title: 'Meeting Rooms', text: 'Huddle room to boardroom', href: '/meeting-rooms/'},
          {icon: 'mic', title: 'Podcast Studio', text: 'Solo, interview and panel', href: '/podcast-studio/'},
          {icon: 'camera', title: 'Photo Studio', text: 'Hourly to full day', href: '/photo-studio/'},
          {icon: 'briefcase-business', title: 'Virtual Office', text: 'Address and mail handling', href: '/virtual-office/'},
          {icon: 'mail', title: 'Mailbox Rental', text: 'Private, secure mailboxes', href: '/mail-box/'},
          {icon: 'calendar-check', title: 'Event Space', text: 'Workshops and launches', href: '/events/'},
        ]},
      {kind: 'faq', id: 'local-faq', bg: 'cream', eyebrow: 'GOOD TO KNOW', title: 'Visiting Workspace Junction',
        items: [
          {q: 'Where is Workspace Junction located?', a: 'We are at 1S280 Summit Ave, Unit E2, Suite 1, Oakbrook Terrace, IL 60181, in the western suburbs of Chicago, next to Oak Brook and close to Villa Park, Lombard and Elmhurst.'},
          {q: 'What are your opening hours?', a: 'Monday to Friday 6 am to 9 pm, and Saturday and Sunday 9 am to 5 pm. Holiday hours can differ; our Google Business Profile shows any changes.'},
          {q: 'Which communities do you serve?', a: 'Oakbrook Terrace, Oak Brook, Lombard, Villa Park, Elmhurst, Downers Grove and Chicago. Many virtual office and business address clients are based further away and never need to visit.'},
          {q: 'Can my business use your address if it is not in Oakbrook Terrace?', a: 'Yes. Our business address and virtual office plans give you a commercial street address in Oakbrook Terrace that you can use for registration, licensing and your website.'},
          {q: 'How do I book a space or service?', a: 'Choose the service on our website and book online; the booking form confirms the final price before you pay. You can also call us at (773) 986-1908.'},
        ]},
      closing('Come See the Space', 'Book a tour and see the coworking floor, rooms and studios for yourself.', 'Book a Tour'),
    ],
  },
};
