'use client';
import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import type { TranslationKey } from '@/lib/i18n/translations';

/** Maps the sentinel the server action redirects with to a translatable key. */
const KNOWN_ERRORS: Record<string, TranslationKey> = {
  'Could not authenticate user': 'login_invalid',
};

export function LoginView({
  error,
  login,
}: {
  error?: string;
  login: (formData: FormData) => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [showPassword, setShowPassword] = useState(false);

  const errorKey = error ? KNOWN_ERRORS[error] : undefined;
  const errorMessage = error ? (errorKey ? t(errorKey) : error) : undefined;

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Aurora field */}
      <div aria-hidden="true" className="grid-overlay pointer-events-none absolute inset-0">
        <div className="orb-drift absolute -top-56 start-1/4 h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(circle,var(--canvas-glow-1),transparent_62%)] blur-3xl" />
        <div className="orb-drift-slow absolute -bottom-64 end-1/4 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,var(--canvas-glow-2),transparent_62%)] blur-3xl" />
      </div>

      <div className="relative flex flex-1 flex-col justify-between p-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="sheen-top aurora-bg glow-brand grid h-9 w-9 place-items-center rounded-xl text-white">
              <Fingerprint size={17} aria-hidden="true" />
            </span>
            <span className="text-sm font-bold tracking-tight text-ink">
              {t('app_title')}
              <span className="aurora-ring ms-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-brand uppercase">
                Pro
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>

        <div className="animate-in fade-in slide-in-from-bottom-8 mx-auto my-auto w-full max-w-[26rem] py-8 duration-500">
          <div className="sheen-top card-face aurora-ring relative rounded-3xl border border-line p-7 shadow-pop sm:p-8">
            <div className="space-y-2 text-center">
              <span className="sheen-top aurora-bg glow-brand mx-auto grid h-12 w-12 place-items-center rounded-2xl text-white">
                <Lock size={20} aria-hidden="true" />
              </span>
              <h1 className="pt-1 text-2xl font-bold tracking-tight text-ink">
                {t('login_title')}
              </h1>
              <p className="text-xs text-ink-muted">{t('login_subtitle')}</p>
            </div>

            <form className="mt-7 space-y-4">
              <Field label={t('login_email')} required>
                <div className="relative">
                  <Mail
                    size={15}
                    aria-hidden="true"
                    className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-subtle"
                  />
                  <Input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder={t('login_email_placeholder')}
                    className="h-11 ps-10"
                  />
                </div>
              </Field>

              <Field label={t('login_password')} required>
                <div className="relative">
                  <Lock
                    size={15}
                    aria-hidden="true"
                    className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-subtle"
                  />
                  <Input
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder={t('login_password_placeholder')}
                    className="h-11 px-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={
                      showPassword ? t('login_hide_password') : t('login_show_password')
                    }
                    className="absolute end-2 top-1/2 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>

              {errorMessage && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-danger-line bg-danger-soft px-3.5 py-3 text-xs leading-relaxed font-medium text-danger"
                >
                  <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </p>
              )}

              <Button
                type="submit"
                formAction={login}
                size="lg"
                trailingIcon={ArrowRight}
                className="group/btn mt-1 w-full"
              >
                {t('login_submit')}
              </Button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-1.5 border-t border-line pt-5 text-[11px] font-medium text-ink-subtle">
              <ShieldCheck size={13} className="text-emerald-500" aria-hidden="true" />
              <span>{t('company_name')}</span>
            </div>
          </div>
        </div>

        <p className="mx-auto max-w-5xl pb-1 text-center text-[11px] text-ink-subtle">
          {t('login_footer')}
        </p>
      </div>
    </div>
  );
}
