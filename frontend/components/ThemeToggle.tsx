'use client';
import { useTheme } from '@/components/ThemeProvider';
import { Sun, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) {
        return (
            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 animate-pulse" />
        );
    }

    return (
        <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="relative p-2 rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 transition-all duration-200 cursor-pointer shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
            {theme === 'dark' ? (
                <Sun size={18} className="text-amber-400 transition-transform duration-200 hover:rotate-45" />
            ) : (
                <Moon size={18} className="text-slate-600 transition-transform duration-200 hover:-rotate-12" />
            )}
        </button>
    );
}
