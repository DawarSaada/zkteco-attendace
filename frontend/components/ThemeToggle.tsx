'use client';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { useLanguage } from '@/components/LanguageContext';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === 'dark';
  const label = isDark ? t('switch_to_light') : t('switch_to_dark');

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      className="group relative grid h-9 w-9 cursor-pointer place-items-center rounded-xl border border-line bg-surface-2/70 text-ink-muted transition-all duration-200 hover:border-line-strong hover:text-ink"
    >
      {isDark ? (
        <Sun
          size={16}
          aria-hidden="true"
          className="text-amber-400 transition-transform duration-300 group-hover:rotate-45"
        />
      ) : (
        <Moon
          size={16}
          aria-hidden="true"
          className="transition-transform duration-300 group-hover:-rotate-12"
        />
      )}
    </button>
  );
}
