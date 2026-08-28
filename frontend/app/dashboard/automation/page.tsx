'use client';
import { useEffect, useState, useCallback } from 'react';
import { ReportAutomation, ReportAutomationLog } from '@/types';
import { useLanguage } from '@/components/LanguageContext';
import { 
    MailCheck, 
    Plus, 
    Send, 
    RotateCw, 
    Trash2, 
    Edit, 
    Calendar, 
    Clock, 
    Building2, 
    CheckCircle2, 
    AlertCircle, 
    X
} from 'lucide-react';

export default function AutomationPage() {
    const [rules, setRules] = useState<ReportAutomation[]>([]);
    const [logs, setLogs] = useState<ReportAutomationLog[]>([]);
    const [branches, setBranches] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [sendingId, setSendingId] = useState<string | null>(null);
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<ReportAutomation | null>(null);
    const [modalBranch, setModalBranch] = useState('all');
    const [modalEmails, setModalEmails] = useState('');
    const [modalFormat, setModalFormat] = useState<'excel' | 'pdf' | 'both'>('both');
    const [modalStartDay, setModalStartDay] = useState(26);
    const [modalEndDay, setModalEndDay] = useState(25);
    const [modalDispatchDay, setModalDispatchDay] = useState(26);
    const [modalIsActive, setModalIsActive] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const { t, isRTL } = useLanguage();

    const showToast = (text: string, type: 'success' | 'error' = 'success') => {
        setToastMsg({ text, type });
        setTimeout(() => setToastMsg(null), 5000);
    };

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [autoRes, empRes, devRes] = await Promise.all([
                fetch('/api/automation'),
                fetch('/api/employees'),
                fetch('/api/devices')
            ]);

            if (autoRes.ok) {
                const autoData = await autoRes.json();
                setRules(autoData.rules || []);
                setLogs(autoData.logs || []);
            }

            const branchSet = new Set<string>();
            if (empRes.ok) {
                const empData = await empRes.json();
                (empData || []).forEach((e: any) => e.branch && branchSet.add(e.branch));
            }
            if (devRes.ok) {
                const devData = await devRes.json();
                (devData || []).forEach((d: any) => d.branch && branchSet.add(d.branch));
            }

            const uniqueBranches = Array.from(branchSet).filter(Boolean);
            setBranches(uniqueBranches);
            if (uniqueBranches.length > 0 && modalBranch === 'all') {
                setModalBranch(uniqueBranches[0]);
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error fetching automation data.', 'error');
        } finally {
            setLoading(false);
        }
    }, [modalBranch]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const openCreateModal = () => {
        setEditingRule(null);
        setModalBranch(branches[0] || 'all');
        setModalEmails('');
        setModalFormat('both');
        setModalStartDay(26);
        setModalEndDay(25);
        setModalDispatchDay(26);
        setModalIsActive(true);
        setIsModalOpen(true);
    };

    const openEditModal = (rule: ReportAutomation) => {
        setEditingRule(rule);
        setModalBranch(rule.branch);
        setModalEmails(rule.recipient_emails.join(', '));
        setModalFormat(rule.report_format);
        setModalStartDay(rule.cycle_start_day || 26);
        setModalEndDay(rule.cycle_end_day || 25);
        setModalDispatchDay(rule.dispatch_day || 26);
        setModalIsActive(rule.is_active);
        setIsModalOpen(true);
    };

    const handleSaveRule = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);

        const emailList = modalEmails
            .split(',')
            .map(email => email.trim())
            .filter(Boolean);

        if (emailList.length === 0) {
            showToast('Please enter at least one recipient email address.', 'error');
            setIsSaving(false);
            return;
        }

        try {
            const payload = {
                id: editingRule?.id,
                branch: modalBranch,
                recipient_emails: emailList,
                cycle_start_day: Number(modalStartDay),
                cycle_end_day: Number(modalEndDay),
                dispatch_day: Number(modalDispatchDay),
                dispatch_time: '08:00:00',
                report_format: modalFormat,
                is_active: modalIsActive
            };

            const res = await fetch('/api/automation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (res.ok) {
                showToast(editingRule ? 'Automation rule updated.' : 'Automation rule created.');
                setIsModalOpen(false);
                fetchData();
            } else {
                showToast(data.error || 'Failed to save automation rule.', 'error');
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error saving automation rule.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteRule = async (id: string) => {
        if (!confirm('Are you sure you want to delete this automated reporting rule?')) return;
        try {
            const res = await fetch(`/api/automation?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Automation rule deleted.');
                fetchData();
            } else {
                showToast('Failed to delete rule.', 'error');
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error deleting rule.', 'error');
        }
    };

    const handleTestSend = async (rule: ReportAutomation) => {
        setSendingId(rule.id);
        try {
            const res = await fetch('/api/automation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'test_send',
                    automation_id: rule.id,
                    branch: rule.branch,
                    recipients: rule.recipient_emails,
                    cycle_start_day: rule.cycle_start_day,
                    cycle_end_day: rule.cycle_end_day,
                    report_format: rule.report_format || 'both'
                })
            });

            const data = await res.json();
            if (res.ok) {
                showToast(data.message || 'Report generated and dispatched.');
                fetchData();
            } else {
                showToast(data.error || 'Dispatch failed.', 'error');
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error executing test dispatch.', 'error');
        } finally {
            setSendingId(null);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Toast Notification */}
            {toastMsg && (
                <div className={`p-4 rounded-xl border text-sm font-medium transition-all ${
                    toastMsg.type === 'success' 
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' 
                        : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                }`}>
                    {toastMsg.text}
                </div>
            )}

            {/* Header Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-200 dark:border-slate-800/60">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        {t('auto_title')}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t('auto_subtitle')}
                    </p>
                </div>

                <button
                    type="button"
                    onClick={openCreateModal}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm shadow-blue-500/20 transition-all cursor-pointer w-full sm:w-auto justify-center"
                >
                    <Plus size={16} />
                    <span>{t('auto_btn_create_rule')}</span>
                </button>
            </div>

            {/* Automation Highlights Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="p-5 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50 shrink-0">
                        <Calendar size={22} />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                            {t('auto_payroll_cycle')}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                            {t('auto_payroll_desc')}
                        </p>
                    </div>
                </div>

                <div className="p-5 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50 shrink-0">
                        <Clock size={22} />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm">
                            {t('auto_dispatch_schedule')}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                            {t('auto_dispatch_desc')}
                        </p>
                    </div>
                </div>
            </div>

            {/* Automation Rules Table */}
            <div className="rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs overflow-hidden transition-colors">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
                    <h3 className="font-bold text-base text-slate-900 dark:text-white">
                        {t('auto_rules_title')} ({rules.length})
                    </h3>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left rtl:text-right">
                        <thead className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80">
                            <tr>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('filter_branch')}</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Payroll Cycle</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('auto_recipients')}</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('auto_format')}</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('auto_status')}</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right rtl:text-left">{t('actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                            {rules.map((rule) => {
                                const isSending = sendingId === rule.id;

                                return (
                                    <tr key={rule.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors">
                                        <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">
                                            <div className="flex items-center gap-2">
                                                <Building2 size={16} className="text-blue-500" />
                                                <span>{rule.branch === 'all' ? t('filter_all_branches') : rule.branch}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                                                Day {rule.cycle_start_day || 26} &rarr; Day {rule.cycle_end_day || 25}
                                            </div>
                                            <div className="text-[11px] text-slate-400">
                                                Dispatch: {rule.dispatch_day || 26}th at 08:00
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-wrap gap-1.5 max-w-md">
                                                {rule.recipient_emails.map((email, idx) => (
                                                    <span key={idx} className="px-2 py-0.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                        {email}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                                                {rule.report_format === 'excel' ? 'Excel (.xlsx)' : rule.report_format === 'pdf' ? 'PDF (.pdf)' : 'Excel + PDF'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                                rule.is_active
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                                            }`}>
                                                <span className={`h-1.5 w-1.5 rounded-full ${rule.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                                                <span>{rule.is_active ? t('auto_active') : t('auto_inactive')}</span>
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right rtl:text-left space-x-2 rtl:space-x-reverse">
                                            <button
                                                type="button"
                                                onClick={() => handleTestSend(rule)}
                                                disabled={isSending}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold border border-emerald-200 dark:border-emerald-800/60 transition-colors disabled:opacity-50 cursor-pointer"
                                                title={t('auto_btn_test_send')}
                                            >
                                                {isSending ? <RotateCw size={13} className="animate-spin" /> : <Send size={13} />}
                                                <span>{isSending ? t('auto_sending') : t('auto_btn_test_send')}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => openEditModal(rule)}
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-slate-700 dark:text-slate-300 hover:text-blue-600 text-xs font-semibold border border-slate-200 dark:border-slate-700/80 transition-colors cursor-pointer"
                                            >
                                                <Edit size={13} />
                                                <span>{t('edit')}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteRule(rule.id)}
                                                className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                                                title={t('delete')}
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {rules.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                                        <MailCheck size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                                        {t('auto_no_rules')}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Audit Logs Table */}
            <div className="rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs overflow-hidden transition-colors">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/60">
                    <h3 className="font-bold text-base text-slate-900 dark:text-white">
                        {t('auto_logs_title')}
                    </h3>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left rtl:text-right text-xs">
                        <thead className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 text-slate-500 dark:text-slate-400 uppercase font-semibold">
                            <tr>
                                <th className="px-6 py-3">{t('col_timestamp')}</th>
                                <th className="px-6 py-3">{t('filter_branch')}</th>
                                <th className="px-6 py-3">{t('auto_payroll_cycle')}</th>
                                <th className="px-6 py-3">{t('auto_recipients')}</th>
                                <th className="px-6 py-3">{t('auto_status')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {logs.map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                                    <td className="px-6 py-3.5 font-mono text-slate-600 dark:text-slate-400">
                                        {new Date(log.created_at).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-3.5 font-bold text-slate-900 dark:text-white">
                                        {log.branch}
                                    </td>
                                    <td className="px-6 py-3.5 font-mono text-slate-700 dark:text-slate-300">
                                        {log.period_start} &rarr; {log.period_end}
                                    </td>
                                    <td className="px-6 py-3.5 text-slate-600 dark:text-slate-400">
                                        {(log.recipients || []).join(', ')}
                                    </td>
                                    <td className="px-6 py-3.5">
                                        <div className="flex flex-col items-start gap-1">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                                                log.status === 'SUCCESS' 
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60' 
                                                    : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60'
                                            }`}>
                                                {log.status === 'SUCCESS' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                                                <span>{log.status}</span>
                                            </span>
                                            {log.error_message && (
                                                <span className="text-[11px] text-rose-600 dark:text-rose-400 max-w-xs truncate" title={log.error_message}>
                                                    {log.error_message}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                                        {t('auto_no_logs')}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create / Edit Rule Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-[#0c121e] rounded-2xl p-4 sm:p-6 max-w-lg w-full shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 sm:space-y-5 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                    {t('auto_modal_title')}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Configure custom payroll cycle dates and email recipients.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsModalOpen(false)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveRule} className="space-y-4">
                            {/* Branch Selection */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    {t('auto_modal_branch')} <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={modalBranch}
                                    onChange={e => setModalBranch(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                >
                                    <option value="all">{t('filter_all_branches')}</option>
                                    {branches.map(b => (
                                        <option key={b} value={b}>{b}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Customizable Payroll Cycle Date Range */}
                            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-3">
                                <label className="block text-xs font-bold text-slate-900 dark:text-white">
                                    Payroll Period Timeline Days (1 - 31)
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Start Day (Prev Month)
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={31}
                                            required
                                            value={modalStartDay}
                                            onChange={e => setModalStartDay(Number(e.target.value))}
                                            className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white text-center focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            End Day (Curr Month)
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={31}
                                            required
                                            value={modalEndDay}
                                            onChange={e => setModalEndDay(Number(e.target.value))}
                                            className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white text-center focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                                            Dispatch Day
                                        </label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={31}
                                            required
                                            value={modalDispatchDay}
                                            onChange={e => setModalDispatchDay(Number(e.target.value))}
                                            className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold text-blue-600 dark:text-blue-400 text-center focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>
                                <p className="text-[11px] text-slate-400 leading-tight">
                                    Example: <strong>26 to 25</strong> covers 26th of previous month through 25th of current month, and dispatches on the <strong>26th</strong> at 08:00 AM.
                                </p>
                            </div>

                            {/* Recipient Emails */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    {t('auto_recipients')} <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    required
                                    rows={3}
                                    value={modalEmails}
                                    onChange={e => setModalEmails(e.target.value)}
                                    placeholder={t('auto_modal_emails_placeholder')}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-2 focus:ring-blue-500"
                                />
                                <p className="text-[11px] text-slate-400 mt-1">
                                    {t('auto_modal_emails_hint')}
                                </p>
                            </div>

                            {/* Attachment Format */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    {t('auto_modal_format')}
                                </label>
                                <select
                                    value={modalFormat}
                                    onChange={e => setModalFormat(e.target.value as any)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                >
                                    <option value="both">{t('auto_format_both')}</option>
                                    <option value="excel">{t('auto_format_excel')}</option>
                                    <option value="pdf">{t('auto_format_pdf')}</option>
                                </select>
                            </div>

                            {/* Active Switch */}
                            <div className="flex items-center gap-2 pt-1">
                                <input
                                    type="checkbox"
                                    id="modalIsActive"
                                    checked={modalIsActive}
                                    onChange={e => setModalIsActive(e.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                />
                                <label htmlFor="modalIsActive" className="text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                                    {t('auto_active')}
                                </label>
                            </div>

                            <div className="flex items-center justify-end rtl:justify-start gap-3 pt-3 border-t border-slate-200 dark:border-slate-800/80">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium transition-colors cursor-pointer"
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
                                >
                                    {isSaving ? t('saving') : t('save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
