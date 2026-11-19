'use client';
/** Last-resort boundary for failures in the root layout. Must render its own document. */
export default function GlobalError({error, retry}: {error: unknown; retry: () => void}) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & {digest?: string}).digest ?? '') : '';
  return (
    <html lang="en">
      <body style={{margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f7f4ed', fontFamily: 'Arial, Helvetica, sans-serif', padding: 20}}>
        <title>Something went wrong | Workspace Junction</title>
        <section role="alert" style={{maxWidth: 520, textAlign: 'center'}}>
          <p style={{fontWeight: 800, letterSpacing: '.12em', color: '#0e3421', margin: 0}}>WORKSPACE <span style={{color: '#d7902a'}}>JUNCTION</span></p>
          <h1 style={{color: '#0e3421', fontSize: 30, margin: '18px 0 12px'}}>We&apos;re having trouble right now.</h1>
          <p style={{color: '#59665f', lineHeight: 1.6, margin: '0 0 24px'}}>Please try again in a moment, or call us at (773) 986-1908.</p>
          <button type="button" onClick={() => retry()} style={{background: '#d7902a', color: '#0e3421', border: 0, borderRadius: 999, padding: '12px 24px', fontWeight: 700, cursor: 'pointer'}}>Try again</button>
          {digest && <p style={{color: '#8a938d', fontSize: 12, marginTop: 22}}>Reference: {digest}</p>}
        </section>
      </body>
    </html>
  );
}
