'use client';
import { useEffect, useState } from 'react';
import { Building2, Clock } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

export function Header() {
    const [timeStr, setTimeStr] = useState<string>('');

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
        <header className="w-full h-16 bg-white/80 dark:bg-[#0c121e]/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between px-6 md:px-8 sticky top-0 z-30 transition-colors duration-200 shrink-0">
            <div className="flex items-center space-x-3">
                <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
                    <Building2 size={16} />
                </div>
                <div>
                    <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-none">
                        Dawar Al-Saada Attendance System
                    </h2>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                        Central Hardware Ingestion & Management Portal
                    </p>
                </div>
            </div>

            <div className="flex items-center space-x-3">
                {/* Live Digital Clock */}
                {timeStr && (
                    <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 shadow-2xs">
                        <Clock size={14} className="text-blue-500" />
                        <span>{timeStr}</span>
                    </div>
                )}

                {/* Dark Mode Switcher */}
                <ThemeToggle />
            </div>
        </header>
    );
}
