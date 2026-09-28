'use client';
import { useEffect, useState } from 'react';
import { Clock, Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useNav } from '@/components/NavContext';
import { useLanguage } from '@/components/LanguageContext';

export function Header() {
  const [now, setNow] = useState<Date | null>(null);
  const { mobileOpen, toggleMobile } = useNav();
  const { t } = useLanguage();

  useEffect(() => {
    // Deferred to a frame so the first paint is not blocked by a re-render.
    const frame = requestAnimationFrame(() => setNow(new Date()));
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="sheen-top sticky top-0 z-30 flex h-[68px] w-full shrink-0 items-center justify-between gap-4 border-b border-line bg-surface/60 px-4 backdrop-blur-xl sm:px-6 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={toggleMobile}
          aria-label={t('open_menu')}
          aria-expanded={mobileOpen}
          aria-controls="dashboard-nav-drawer"
          // `shrink-0` keeps the tap target square: without it the header's
          // flex row squeezes this button on narrow phones.
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl border border-line bg-surface-2/70 text-ink-muted transition-colors hover:border-line-strong hover:text-ink lg:hidden"
        >
          <Menu size={17} />
        </button>

        <span
          aria-hidden="true"
          className="aurora-bg hidden h-8 w-1 shrink-0 rounded-full sm:block"
        />

        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold tracking-tight text-ink">
            {t('company_name')}
          </p>
          <p className="hidden truncate text-[11px] font-medium text-ink-subtle md:block">
            {t('company_subtitle')}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
        {now && (
          <time
            dateTime={now.toISOString()}
            data-numeric
            className="hidden items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink-muted sm:flex"
          >
            <Clock size={12} className="text-brand" aria-hidden="true" />
            <span>
              {now.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </time>
        )}

        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
