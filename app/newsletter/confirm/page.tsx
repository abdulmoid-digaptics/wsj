import {Suspense} from 'react';
import type {Metadata} from 'next';
import {PublicLayout} from '@/components/public-layout';
import {NewsletterConfirm} from '@/components/newsletter-pages';

export const metadata: Metadata = {title: 'Confirm your subscription', robots: {index: false, follow: false}};

export default function Page() {
  return (
    <PublicLayout>
      <main id="main" className="bc-page">
        <h1 className="sr-only">Confirm your subscription</h1>
        <Suspense fallback={<div className="bc-wrap"><section className="bc-card bc-pending" role="status"><p className="bc-eyebrow">One moment</p><h2 className="bc-title">Loading…</h2></section></div>}>
          <NewsletterConfirm />
        </Suspense>
      </main>
    </PublicLayout>
  );
}
