'use client';
import { useEffect, useState } from 'react';
import { Building2, Clock, Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { useNav } from '@/components/NavContext';
import { useLanguage } from '@/components/LanguageContext';

export function Header() {
    const [timeStr, setTimeStr] = useState<string>('');
    const { toggleMobile } = useNav();
    const { t } = useLanguage();

    useEffect(() => {
        const updateClock = () => {
            const now = new Date();
            setTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        };
        updateClock();
        const interval = setInterval(updateClock, 1000);
        return () => clearInterval(interval);
    }, []);

    return (
        <header className="w-full h-16 bg-white/80 dark:bg-[#0c121e]/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between px-4 sm:px-6 md:px-8 sticky top-0 z-30 transition-colors duration-200 shrink-0">
            <div className="flex items-center space-x-3 rtl:space-x-reverse">
                {/* Mobile Menu Hamburger Button */}
                <button
                    type="button"
                    onClick={toggleMobile}
                    aria-label="Open mobile menu"
                    className="lg:hidden p-2 rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/80 transition-colors cursor-pointer"
                >
                    <Menu size={18} />
                </button>

                <div className="hidden sm:flex p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
                    <Building2 size={16} />
                </div>
                <div>
                    <h2 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 leading-none">
                        {t('company_name')}
                    </h2>
                    <p className="hidden md:block text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                        {t('company_subtitle')}
                    </p>
                </div>
            </div>

            <div className="flex items-center space-x-2 sm:space-x-3 rtl:space-x-reverse">
                {/* Live Digital Clock */}
                {timeStr && (
                    <div className="flex items-center space-x-1.5 sm:space-x-2 rtl:space-x-reverse px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-[11px] sm:text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 shadow-2xs">
                        <Clock size={13} className="text-blue-500" />
                        <span>{timeStr}</span>
                    </div>
                )}

                {/* Language Switcher */}
                <LanguageToggle />

                {/* Dark Mode Switcher */}
                <ThemeToggle />
            </div>
        </header>
    );
}
