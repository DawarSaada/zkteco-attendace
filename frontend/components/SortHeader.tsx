'use client';
import React from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';

interface SortHeaderProps {
    columnKey: string;
    label: string;
    activeKey?: string;
    sortOrder?: 'asc' | 'desc';
    onSort: (key: string) => void;
    align?: 'left' | 'right' | 'center';
    className?: string;
}

export function SortHeader({
    columnKey,
    label,
    activeKey,
    sortOrder = 'asc',
    onSort,
    align = 'left',
    className = ''
}: SortHeaderProps) {
    const { t } = useLanguage();
    const isActive = activeKey === columnKey;

    const alignClass = 
        align === 'right' 
            ? 'justify-end text-right' 
            : align === 'center' 
            ? 'justify-center text-center' 
            : 'justify-start text-left';

    const tooltip = isActive 
        ? (sortOrder === 'asc' ? t('sort_desc') : t('sort_asc')) 
        : t('sort_neutral');

    return (
        <th 
            className={`px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 select-none ${className}`}
        >
            <button
                type="button"
                onClick={() => onSort(columnKey)}
                title={tooltip}
                className={`group inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer w-full ${alignClass}`}
            >
                <span className={isActive ? 'text-blue-600 dark:text-blue-400 font-bold' : ''}>
                    {label}
                </span>
                <span className="shrink-0 p-0.5 rounded transition-colors group-hover:bg-slate-200/60 dark:group-hover:bg-slate-800">
                    {isActive ? (
                        sortOrder === 'asc' ? (
                            <ArrowUp size={14} className="text-blue-600 dark:text-blue-400" />
                        ) : (
                            <ArrowDown size={14} className="text-blue-600 dark:text-blue-400" />
                        )
                    ) : (
                        <ArrowUpDown size={13} className="text-slate-300 dark:text-slate-600 group-hover:text-slate-500" />
                    )}
                </span>
            </button>
        </th>
    );
}
