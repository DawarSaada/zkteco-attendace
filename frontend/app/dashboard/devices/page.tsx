'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Device } from '@/types';
import { 
    MonitorSmartphone, 
    RotateCw, 
    Power, 
    Edit, 
    Building2, 
    Wifi, 
    WifiOff, 
    X,
    Radio,
    HardDrive
} from 'lucide-react';

export default function DevicesPage() {
    const [devices, setDevices] = useState<Device[]>([]);
    const [loadingAction, setLoadingAction] = useState<string>('');
    const [editingDevice, setEditingDevice] = useState<Device | null>(null);
    const [editName, setEditName] = useState('');
    const [editBranch, setEditBranch] = useState('');
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const supabase = useMemo(() => createClient(), []);

    const showToast = (text: string, type: 'success' | 'error' = 'success') => {
        setToastMsg({ text, type });
        setTimeout(() => setToastMsg(null), 4000);
    };

    const fetchDevices = useCallback(async () => {
        try {
            const res = await fetch('/api/devices');
            if (res.ok) {
                const data = await res.json();
                setDevices(Array.isArray(data) ? data : []);
            } else {
                showToast('Failed to fetch devices.', 'error');
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error fetching devices', 'error');
        }
    }, []);

    useEffect(() => {
        fetchDevices();

        const channel = supabase
            .channel('realtime_devices_page')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => {
                fetchDevices();
            })
            .subscribe();

        return () => { 
            supabase.removeChannel(channel); 
        };
    }, [fetchDevices, supabase]);

    const sendCommand = async (sn: string, command_str: string) => {
        setLoadingAction(`${sn}_${command_str}`);
        try {
            const res = await fetch('/api/devices/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sn, command_str })
            });
            const data = await res.json();
            if (res.ok) {
                showToast(`Command "${command_str}" queued successfully for device ${sn}.`);
            } else {
                showToast(data.error || 'Failed to queue command.', 'error');
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to queue command.', 'error');
        } finally {
            setLoadingAction('');
        }
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingDevice) return;
        try {
            const res = await fetch(`/api/devices/${editingDevice.sn}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editName, branch: editBranch })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Device details updated successfully.');
                setEditingDevice(null);
                fetchDevices();
            } else {
                showToast(data.error || 'Failed to update device.', 'error');
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to update device.', 'error');
        }
    };

    const openEditModal = (device: Device) => {
        setEditingDevice(device);
        setEditName(device.name || '');
        setEditBranch(device.branch || '');
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Toast Notification */}
            {toastMsg && (
                <div className={`p-4 rounded-xl border text-sm font-medium transition-all ${
                    toastMsg.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                }`}>
                    {toastMsg.text}
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-200 dark:border-slate-800/60">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Terminal Devices
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Monitor physical ZKTeco hardware terminals, dispatch ADMS commands, and assign branch locations.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
                        {devices.length} Registered Terminals
                    </span>
                </div>
            </div>
            
            {/* Device Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {devices.map(device => {
                    const lastActive = new Date(device.last_active);
                    const isOnline = (new Date().getTime() - lastActive.getTime()) < 5 * 60 * 1000;
                    const syncKey = `${device.sn}_DATA QUERY ATTLOG`;
                    const rebootKey = `${device.sn}_REBOOT`;
                    
                    return (
                        <div key={device.sn} className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-col justify-between transition-all hover:border-slate-300 dark:hover:border-slate-700">
                            <div>
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="font-bold text-base text-slate-900 dark:text-white">
                                            {device.name || 'Unnamed Terminal'}
                                        </h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">
                                            SN: {device.sn}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1.5">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                            isOnline 
                                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60' 
                                                : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60'
                                        }`}>
                                            <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                                            <span>{isOnline ? 'Online' : 'Offline'}</span>
                                        </span>
                                        <button 
                                            type="button"
                                            onClick={() => openEditModal(device)}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                                        >
                                            Edit Details
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2 py-3 border-y border-slate-100 dark:divide-slate-800/60 text-xs text-slate-600 dark:text-slate-400">
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-400">Branch:</span>
                                        <span className="font-semibold text-slate-900 dark:text-slate-200">
                                            {device.branch || 'Unassigned'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-400">IP Address:</span>
                                        <span className="font-mono text-slate-800 dark:text-slate-300">
                                            {device.ip_address || 'DHCP / Dynamic'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-400">Last Active:</span>
                                        <span className="font-mono text-slate-800 dark:text-slate-300">
                                            {lastActive.toLocaleTimeString()} ({lastActive.toISOString().substring(0, 10)})
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Command Buttons */}
                            <div className="mt-5 pt-3 grid grid-cols-2 gap-2">
                                <button 
                                    type="button"
                                    onClick={() => sendCommand(device.sn, 'DATA QUERY ATTLOG')}
                                    disabled={loadingAction === syncKey}
                                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-semibold border border-blue-200 dark:border-blue-800/60 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                    <RotateCw size={13} className={loadingAction === syncKey ? 'animate-spin' : ''} />
                                    <span>{loadingAction === syncKey ? 'Sending...' : 'Sync Logs'}</span>
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => sendCommand(device.sn, 'REBOOT')}
                                    disabled={loadingAction === rebootKey}
                                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-700/80 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                    <Power size={13} />
                                    <span>{loadingAction === rebootKey ? 'Sending...' : 'Reboot'}</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
                {devices.length === 0 && (
                    <div className="col-span-full p-12 text-center text-slate-400 dark:text-slate-500 bg-white dark:bg-[#0c121e] rounded-2xl border border-dashed border-slate-300 dark:border-slate-800">
                        <MonitorSmartphone size={36} className="mx-auto mb-3 text-slate-300 dark:text-slate-700" />
                        <h4 className="font-semibold text-slate-700 dark:text-slate-300 text-base">No Devices Connected</h4>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm mx-auto">
                            Configure your ZKTeco hardware ADMS / Cloud Server settings to point to this server URL.
                        </p>
                    </div>
                )}
            </div>

            {/* Edit Device Modal */}
            {editingDevice && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-[#0c121e] rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 animate-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Edit Device Settings</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">SN: {editingDevice.sn}</p>
                            </div>
                            <button 
                                type="button"
                                onClick={() => setEditingDevice(null)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveEdit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    Device Custom Name
                                </label>
                                <input 
                                    type="text" 
                                    value={editName} 
                                    onChange={e => setEditName(e.target.value)} 
                                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500" 
                                    placeholder="e.g. Main Lobby Scanner" 
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    Assigned Branch Location
                                </label>
                                <input 
                                    type="text" 
                                    value={editBranch} 
                                    onChange={e => setEditBranch(e.target.value)} 
                                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500" 
                                    placeholder="e.g. Riyadh Headquarters" 
                                />
                            </div>
                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800/80">
                                <button 
                                    type="button" 
                                    onClick={() => setEditingDevice(null)} 
                                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm shadow-blue-500/20 transition-all cursor-pointer"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
