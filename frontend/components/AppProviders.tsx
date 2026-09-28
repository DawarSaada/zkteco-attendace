'use client';
import { LanguageProvider, useLanguage } from '@/components/LanguageContext';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import type { ReactNode } from 'react';

/** Toast chrome needs the active language, so it lives inside the provider. */
function ToastHost({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return <ToastProvider closeLabel={t('dismiss')}>{children}</ToastProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastHost>{children}</ToastHost>
      </LanguageProvider>
    </ThemeProvider>
  );
}
