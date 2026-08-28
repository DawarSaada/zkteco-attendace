'use client';
import { useLanguage } from '@/components/LanguageContext';
import { Languages } from 'lucide-react';

export function LanguageToggle() {
    const { language, toggleLanguage, t } = useLanguage();

    return (
        <button
            type="button"
            onClick={toggleLanguage}
            title={language === 'en' ? 'التحويل إلى اللغة العربية' : 'Switch to English'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700/60 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all cursor-pointer shadow-2xs"
        >
            <Languages size={14} className="text-blue-600 dark:text-blue-400" />
            <span>{language === 'en' ? 'العربية' : 'English'}</span>
        </button>
    );
}
