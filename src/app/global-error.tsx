'use client';

/** Last-resort boundary (root layout failed). Plain markup only: no app components or styles can be assumed to load. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }): React.ReactNode {
  return <html lang="en"><body>
    <main>
      <h1>The operator console could not load</h1>
      <p>Nothing was changed. Reload the page; if this persists, contact an administrator.</p>
      <button type="button" onClick={reset}>Reload</button>
    </main>
  </body></html>;
}
