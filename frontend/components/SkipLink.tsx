'use client';
import { useLanguage } from '@/components/LanguageContext';

/** Keyboard-only escape hatch past the sidebar; hidden until focused. */
export function SkipLink({ targetId }: { targetId: string }) {
  const { t } = useLanguage();

  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[100] focus:rounded-xl focus:border focus:border-brand-line focus:bg-surface focus:px-4 focus:py-2.5 focus:text-xs focus:font-semibold focus:text-ink focus:shadow-pop"
    >
      {t('skip_to_content')}
    </a>
  );
}
