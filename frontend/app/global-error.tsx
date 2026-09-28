'use client';
import { useEffect } from 'react';
import { AlertOctagon } from 'lucide-react';

/**
 * Last-resort boundary. It replaces the root layout, so it must render its own
 * `<html>`/`<body>` and cannot rely on `globals.css` or the language provider —
 * styles are inline on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global] fatal error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#090d16',
          color: '#f1f5f9',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '32rem',
            border: '1px solid rgba(148,163,184,0.2)',
            background: '#0c121e',
            borderRadius: '16px',
            padding: '28px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              color: '#fb7185',
            }}
          >
            <AlertOctagon size={22} aria-hidden="true" />
            <strong style={{ fontSize: '1rem' }}>
              The application failed to start
            </strong>
          </div>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: '0.85rem',
              lineHeight: 1.6,
              color: '#94a3b8',
            }}
          >
            A critical error prevented the interface from rendering. Reload the
            page to try again. If it keeps failing, share the reference below
            with your administrator.
          </p>
          {error.digest && (
            <p
              style={{
                margin: '16px 0 0',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.7rem',
                color: '#64748b',
                wordBreak: 'break-all',
              }}
            >
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '24px',
              cursor: 'pointer',
              border: 'none',
              borderRadius: '10px',
              background: '#2563eb',
              color: '#fff',
              fontSize: '0.8rem',
              fontWeight: 600,
              padding: '10px 18px',
            }}
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
