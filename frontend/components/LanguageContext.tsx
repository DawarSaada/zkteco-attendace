'use client';
import React, { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
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

const STORAGE_KEY = 'btime_language';
const listeners = new Set<() => void>();

function subscribeToLanguage(listener: () => void) {
    listeners.add(listener);
    // Also fires when another tab switches the language.
    window.addEventListener('storage', listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', listener);
    };
}

/** Must be a primitive so React can compare snapshots by value. */
function readStoredLanguage(): Language {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en';
    } catch {
        return 'en';
    }
}

/** Rendered by the server and during hydration, so the markup matches. */
function readServerLanguage(): Language {
    return 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    // Reading the store instead of setting state from an effect keeps the first
    // client render identical to the server's, so the language never has to be
    // written back during a render pass.
    const language = useSyncExternalStore(subscribeToLanguage, readStoredLanguage, readServerLanguage);

    const setLanguage = useCallback((lang: Language) => {
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch {
            // Storage can be unavailable; keep the in-memory switch working.
        }
        listeners.forEach((listener) => listener());
    }, []);

    const toggleLanguage = useCallback(() => {
        setLanguage(language === 'en' ? 'ar' : 'en');
    }, [language, setLanguage]);

    // Synchronises the document with the active language. A DOM side effect
    // only — `app/layout.tsx` sets the same attributes before first paint.
    useEffect(() => {
        document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = language;
    }, [language]);

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
