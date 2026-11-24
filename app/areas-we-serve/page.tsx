import Link from 'next/link';
import type {Metadata} from 'next';
import {ArrowUpRight, Clock, MapPin, Navigation, Phone, Star} from 'lucide-react';
import {PublicLayout} from '@/components/public-layout';
import {RouteStructuredData} from '@/components/route-structured-data';
import {BUSINESS, withPageSeo} from '@/lib/seo';
import './areas.css';

export const revalidate = 3600;
export async function generateMetadata(): Promise<Metadata> {
  return withPageSeo('/areas-we-serve/', {});
}

/* Only facts and pages that already exist on the site. No invented distances or drive times:
   directions open Google Maps from each community to the Business Profile pin. */
const AREAS: Array<{name: string; note: string; guides: Array<[string, string]>}> = [
  {name: 'Oakbrook Terrace', note: 'Our home base on Summit Avenue, with coworking, private rooms, studios and business services under one roof.', guides: [['Coworking, podcast studios and mailboxes in Chicagoland', '/coworking-space-in-oakbrook-terrace/'], ['Office space for rent in Oakbrook Terrace', '/office-space-for-rent-oakbrook-terrace/'], ['Virtual mailbox in Oakbrook Terrace', '/virtual-mailbox-oakbrook-terrace/']]},
  {name: 'Oak Brook', note: 'Next door to Oak Brook: book a meeting room, set up a business address or work from a dedicated desk.', guides: [['Virtual mailbox services in Oak Brook and Lombard', '/virtual-mailbox-service-oak-brook/'], ['Virtual mailbox service for Oak Brook and Lombard', '/virtual-mailbox-service-oak-brook-lombard/']]},
  {name: 'Lombard', note: 'A short trip for Lombard founders who want a professional address, a meeting room or a place to record.', guides: [['Virtual mailbox service for Oak Brook and Lombard', '/virtual-mailbox-service-oak-brook-lombard/']]},
  {name: 'Villa Park', note: 'Use a commercial address in Oakbrook Terrace for registration, licensing and your website.', guides: [['Professional business address in the Chicago suburbs', '/professional-business-address-villa-park/']]},
  {name: 'Elmhurst', note: 'Coworking, dedicated desks and studios for Elmhurst professionals who want to work closer to home.', guides: [['The best coworking space in Chicago and Elmhurst', '/best-coworking-space-in-chicago/']]},
  {name: 'Downers Grove', note: 'Mailbox rental, virtual mailbox and business address services for Downers Grove businesses.', guides: [['Virtual mailbox near Downers Grove', '/virtual-mailbox-downers-grove/'], ['Virtual mailbox services near Downers Grove', '/virtual-mailbox-service-near-downers-grove/']]},
  {name: 'Chicago', note: 'A western-suburbs alternative to downtown space, for Chicago teams, creators and remote workers.', guides: [['Finding the best coworking space in Chicagoland', '/coworking-space-chicago/'], ['Podcast studios in Chicago', '/podcast-studio-chicago/'], ['Virtual mailbox service in Chicago', '/virtual-mailbox-service-chicago/'], ['Office spaces for rent in Chicago', '/office-spaces-for-rent-in-chicago/'], ['Dedicated desk vs. coworking', '/dedicated-desk-rental-chicago/']]},
];

const SERVICES: Array<[string, string]> = [['Coworking', '/coworking/'], ['Dedicated desks', '/dedicated/'], ['Meeting rooms', '/meeting-rooms/'], ['Podcast studio', '/podcast-studio/'], ['Photo studio', '/photo-studio/'], ['Virtual office', '/virtual-office/'], ['Business address', '/business-address/'], ['Mailbox rental', '/mail-box/'], ['Event space', '/events/']];

const directions = (from: string) => 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(from + ', IL') + '&destination=' + encodeURIComponent('Workspace Junction, ' + BUSINESS.street + ', ' + BUSINESS.locality + ', IL ' + BUSINESS.postalCode);

export default function AreasWeServePage() {
  return (
    <PublicLayout>
      <main id="main" className="aws">
        <section className="aws-hero">
          <div className="aws-shell">
            <nav className="aws-crumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><span aria-current="page">Areas we serve</span></nav>
            <p className="aws-eyebrow">OAKBROOK TERRACE &middot; WESTERN CHICAGO SUBURBS</p>
            <h1>Coworking and business services near Oak Brook, Lombard, Elmhurst and Chicago</h1>
            <p className="aws-lead">Workspace Junction is at {BUSINESS.street}, {BUSINESS.locality}, {BUSINESS.region} {BUSINESS.postalCode}. Founders, freelancers, creators and teams from these communities use our coworking floor, meeting rooms, studios and business address services.</p>
          </div>
        </section>

        <section className="aws-shell aws-visit" aria-labelledby="aws-visit-title">
          <div className="aws-nap">
            <h2 id="aws-visit-title">Visit Workspace Junction</h2>
            <p><MapPin size={18} aria-hidden="true" /> <a href={BUSINESS.mapUrl} target="_blank" rel="noreferrer">{BUSINESS.street}, {BUSINESS.locality}, {BUSINESS.region} {BUSINESS.postalCode}</a></p>
            <p><Phone size={18} aria-hidden="true" /> <a href={'tel:' + BUSINESS.phone}>{BUSINESS.phoneDisplay}</a></p>
            <div className="aws-hours"><Clock size={18} aria-hidden="true" /><dl>{BUSINESS.hours.map(h => <div key={h.label}><dt>{h.label}</dt><dd>{h.display}</dd></div>)}</dl></div>
            <p className="aws-actions">
              <a className="aws-button" href={BUSINESS.mapUrl} target="_blank" rel="noreferrer"><Navigation size={16} aria-hidden="true" /> Open in Google Maps</a>
              <a className="aws-button aws-ghost" href={BUSINESS.reviewUrl} target="_blank" rel="noreferrer"><Star size={16} aria-hidden="true" /> Review us on Google</a>
            </p>
          </div>
          <iframe className="aws-map" title="Map showing Workspace Junction in Oakbrook Terrace, Illinois" src={BUSINESS.embedUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </section>

        <section className="aws-shell" aria-labelledby="aws-areas-title">
          <h2 id="aws-areas-title" className="aws-h2">Communities we serve</h2>
          <div className="aws-grid">
            {AREAS.map(area => (
              <article key={area.name} className="aws-card" id={area.name.toLowerCase().replace(/\s+/g, '-')}>
                <h3>Workspace near {area.name}</h3>
                <p>{area.note}</p>
                <a className="aws-link" href={directions(area.name)} target="_blank" rel="noreferrer">Directions from {area.name} <ArrowUpRight size={15} aria-hidden="true" /></a>
                {area.guides.length > 0 && <ul aria-label={'Guides for ' + area.name}>{area.guides.map(([label, href]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>}
              </article>
            ))}
          </div>
        </section>

        <section className="aws-shell aws-services" aria-labelledby="aws-services-title">
          <h2 id="aws-services-title" className="aws-h2">What you can book</h2>
          <ul>{SERVICES.map(([label, href]) => <li key={href}><Link href={href}>{label} <ArrowUpRight size={14} aria-hidden="true" /></Link></li>)}</ul>
        </section>
      </main>
      <RouteStructuredData path="/areas-we-serve/" title="Areas we serve" />
    </PublicLayout>
  );
}
