'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations, Language, TranslationKey } from '@/lib/i18n/translations';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    toggleLanguage: () => void;
    t: (key: TranslationKey, fallback?: string) => string;
    isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType>({
    language: 'en',
    setLanguage: () => {},
    toggleLanguage: () => {},
    t: (key: TranslationKey) => key,
    isRTL: false,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguageState] = useState<Language>('en');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const savedLang = localStorage.getItem('btime_language') as Language;
        if (savedLang === 'ar' || savedLang === 'en') {
            setLanguageState(savedLang);
            document.documentElement.dir = savedLang === 'ar' ? 'rtl' : 'ltr';
            document.documentElement.lang = savedLang;
        } else {
            // Default to 'en'
            document.documentElement.dir = 'ltr';
            document.documentElement.lang = 'en';
        }
    }, []);

    const setLanguage = useCallback((lang: Language) => {
        setLanguageState(lang);
        if (typeof window !== 'undefined') {
            localStorage.setItem('btime_language', lang);
            document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
            document.documentElement.lang = lang;
        }
    }, []);

    const toggleLanguage = useCallback(() => {
        const nextLang = language === 'en' ? 'ar' : 'en';
        setLanguage(nextLang);
    }, [language, setLanguage]);

    const t = useCallback((key: TranslationKey, fallback?: string): string => {
        const dict = translations[language] || translations.en;
        return (dict[key] as string) || fallback || translations.en[key] || (key as string);
    }, [language]);

    const isRTL = language === 'ar';

    return (
        <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t, isRTL }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    return useContext(LanguageContext);
}
