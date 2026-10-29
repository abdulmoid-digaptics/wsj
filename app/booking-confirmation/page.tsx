import type {Metadata} from 'next';
import Link from 'next/link';
import {PublicLayout} from '@/components/public-layout';
import {BookingStatus} from '@/components/booking-status';

export const metadata:Metadata={title:'Booking confirmation',robots:{index:false,follow:true}};

type Props={searchParams:Promise<{booking?:string}>};

export default async function BookingConfirmationPage({searchParams}:Props){
 const {booking}=await searchParams;
 return <PublicLayout>
  <main id="main" className="wj-policy">
   <header className="wj-policy-header">
    <div className="container">
     <p className="eyebrow">BOOKING</p>
     <h1>Booking confirmation.</h1>
    </div>
   </header>
   <article className="container wj-policy-body">
    {booking
     ? <BookingStatus id={booking}/>
     : <>
        <p>We couldn&apos;t find a booking reference in this link.</p>
        <p><Link href="/">Return home</Link> or <Link href="/contact-us/">contact us</Link> if you completed a payment and landed here by mistake.</p>
       </>}
   </article>
  </main>
 </PublicLayout>;
}
