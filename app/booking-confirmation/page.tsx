import {Suspense} from 'react';
import type {Metadata} from 'next';
import {PublicLayout} from '@/components/public-layout';
import {BookingConfirmationClient} from '@/components/booking-status';

export const metadata: Metadata = {
  title: 'Booking confirmation',
  robots: {index: false, follow: true},
};

export default function BookingConfirmationPage() {
  return (
    <PublicLayout>
      <main id="main" className="bc-page">
        <h1 className="sr-only">Booking confirmation</h1>
        <Suspense fallback={<div className="bc-wrap"><section className="bc-card bc-pending" role="status"><p className="bc-eyebrow">One moment</p><h2 className="bc-title">Loading your booking…</h2></section></div>}>
          <BookingConfirmationClient />
        </Suspense>
      </main>
    </PublicLayout>
  );
}
