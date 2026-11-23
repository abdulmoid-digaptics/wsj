'use client';
/**
 * Page-level error boundary. Customers see a calm message and a reference code, never
 * the underlying error. The reference (Next.js digest) matches the server-side log line.
 */
import Link from 'next/link';

export default function Error({error, retry}: {error: unknown; retry: () => void}) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & {digest?: string}).digest ?? '') : '';
  return (
    <main style={{minHeight: '60vh', display: 'grid', placeItems: 'center', padding: '64px 20px', background: '#f7f4ed'}}>
      <section role="alert" style={{maxWidth: 520, textAlign: 'center', fontFamily: 'inherit'}}>
        <p style={{font: '700 12px/1.4 inherit', letterSpacing: '.14em', textTransform: 'uppercase', color: '#d7902a', margin: 0}}>Something went wrong</p>
        <h1 style={{color: '#0e3421', fontSize: 'clamp(28px, 5vw, 40px)', lineHeight: 1.15, margin: '12px 0 14px'}}>We couldn&apos;t load this page.</h1>
        <p style={{color: '#59665f', lineHeight: 1.6, margin: '0 0 24px'}}>Please try again. If it keeps happening, call us at (773) 986-1908 and we will help right away.</p>
        <div style={{display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap'}}>
          <button type="button" onClick={() => retry()} style={{background: '#d7902a', color: '#0e3421', border: 0, borderRadius: 999, padding: '12px 24px', fontWeight: 700, cursor: 'pointer'}}>Try again</button>
          <Link href="/" style={{border: '1px solid #0e3421', color: '#0e3421', borderRadius: 999, padding: '11px 24px', fontWeight: 700, textDecoration: 'none'}}>Go to homepage</Link>
        </div>
        {digest && <p style={{color: '#8a938d', fontSize: 12, marginTop: 22}}>Reference: {digest}</p>}
      </section>
    </main>
  );
}
