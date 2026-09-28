'use client';
import { Compass, Home } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  const { t } = useLanguage();

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="animate-in fade-in slide-in-from-bottom-8 w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card duration-300">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-brand-line bg-brand-soft text-brand">
          <Compass size={24} aria-hidden="true" />
        </span>
        <p className="mt-5 font-mono text-xs font-bold tracking-[0.3em] text-ink-subtle">
          404
        </p>
        <h1 className="mt-2 text-xl font-bold text-ink">{t('nf_title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {t('nf_desc')}
        </p>
        <Button
          href="/dashboard"
          icon={Home}
          className="mx-auto mt-6 w-full sm:w-auto"
        >
          {t('back_to_dashboard')}
        </Button>
      </div>
    </div>
  );
}
