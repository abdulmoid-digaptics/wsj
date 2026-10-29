'use client';
import {Suspense} from 'react';
import {useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {PublicLayout} from '@/components/public-layout';
import {BookingStatus} from '@/components/booking-status';

function BookingContent() {
 const searchParams = useSearchParams();
 const booking = searchParams.get('booking') || undefined;
 return (
  <article className="container wj-policy-body">
   {booking
    ? <BookingStatus id={booking}/>
    : <>
       <p>We couldn&apos;t find a booking reference in this link.</p>
       <p><Link href="/">Return home</Link> or <Link href="/contact-us/">contact us</Link> if you completed a payment and landed here by mistake.</p>
      </>}
  </article>
 );
}

export default function BookingConfirmationPage() {
 return <PublicLayout>
  <main id="main" className="wj-policy">
   <header className="wj-policy-header">
    <div className="container">
     <p className="eyebrow">BOOKING</p>
     <h1>Booking confirmation.</h1>
    </div>
   </header>
   <Suspense fallback={<article className="container wj-policy-body"><p>Loading booking details&hellip;</p></article>}>
    <BookingContent />
   </Suspense>
  </main>
 </PublicLayout>;
}
