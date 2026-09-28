'use client';
import { useEffect } from 'react';
import { AlertOctagon, Home, RotateCw } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Button } from '@/components/ui/Button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    console.error('[dashboard] unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="animate-in fade-in slide-in-from-bottom-8 w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-card duration-300 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-danger-line bg-danger-soft text-danger">
            <AlertOctagon size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-ink">{t('err_title')}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              {t('err_desc')}
            </p>
          </div>
        </div>

        {error.digest && (
          <p className="mt-5 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 font-mono text-[11px] break-all text-ink-muted">
            {t('err_reference')}: {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2.5">
          <Button icon={RotateCw} onClick={reset}>
            {t('retry')}
          </Button>
          <Button variant="secondary" icon={Home} href="/dashboard">
            {t('back_to_dashboard')}
          </Button>
        </div>
      </div>
    </div>
  );
}
