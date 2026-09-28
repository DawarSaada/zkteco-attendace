'use client';
import { Languages } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';

export function LanguageToggle() {
  const { language, toggleLanguage, t } = useLanguage();

  const label = language === 'en' ? 'التحويل إلى اللغة العربية' : 'Switch to English';

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      title={label}
      aria-label={`${t('switch_language')} — ${label}`}
      className="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface-2/70 px-2.5 text-xs font-semibold text-ink-muted transition-all duration-200 hover:border-line-strong hover:text-ink"
    >
      <Languages size={13} className="text-brand" aria-hidden="true" />
      <span>{language === 'en' ? 'العربية' : 'English'}</span>
    </button>
  );
}
