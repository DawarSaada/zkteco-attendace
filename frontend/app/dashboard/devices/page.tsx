'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function DevicesPage() {
    const [devices, setDevices] = useState<any[]>([]);
    const [loadingAction, setLoadingAction] = useState<string>('');
    const [editingDevice, setEditingDevice] = useState<any>(null);
    const [editName, setEditName] = useState('');
    const [editBranch, setEditBranch] = useState('');
    const supabase = createClient();

    const fetchDevices = async () => {
        const res = await fetch('/api/devices');
        const data = await res.json();
        setDevices(Array.isArray(data) ? data : []);
    };

    useEffect(() => {
        fetchDevices();

        const channel = supabase
            .channel('realtime_devices')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
                fetchDevices();
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const sendCommand = async (sn: string, command_str: string) => {
        setLoadingAction(sn);
        try {
            await fetch('/api/devices/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sn, command_str })
            });
            alert('Command queued successfully.');
        } catch (err) {
            alert('Failed to queue command.');
        } finally {
            setLoadingAction('');
        }
    };

    const handleSaveEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await fetch(`/api/devices/${editingDevice.sn}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editName, branch: editBranch })
            });
            setEditingDevice(null);
            fetchDevices();
        } catch (err) {
            alert('Failed to update device.');
        }
    };

    const openEditModal = (device: any) => {
        setEditingDevice(device);
        setEditName(device.name || '');
        setEditBranch(device.branch || '');
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Device Management</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {devices.map(device => {
                    const lastActive = new Date(device.last_active);
                    const isOnline = (new Date().getTime() - lastActive.getTime()) < 5 * 60 * 1000;
                    
                    return (
                        <div key={device.sn} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="font-semibold text-lg">{device.name || 'Unnamed Device'}</h3>
                                        <p className="text-sm text-gray-500 font-mono mt-1">SN: {device.sn}</p>
                                        <p className="text-sm text-blue-600 font-medium mt-1">Branch: {device.branch || 'Unassigned'}</p>
                                    </div>
                                    <div className="flex flex-col items-end space-y-2">
                                        <span className={`flex items-center space-x-1 text-sm font-medium px-2 py-1 rounded-full ${isOnline ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-600' : 'bg-red-500'}`}></span>
                                            <span>{isOnline ? 'Online' : 'Offline'}</span>
                                        </span>
                                        <button 
                                            onClick={() => openEditModal(device)}
                                            className="text-sm text-gray-500 hover:text-gray-800 underline"
                                        >
                                            Edit
                                        </button>
                                    </div>
                                </div>
                                <div className="text-sm text-gray-600 space-y-1">
                                    <p>IP Address: {device.ip_address || 'DHCP/Unknown'}</p>
                                    <p>Last heartbeat: {lastActive.toLocaleTimeString()}</p>
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-gray-100 grid grid-cols-2 gap-2">
                                <button 
                                    onClick={() => sendCommand(device.sn, 'DATA QUERY ATTLOG')}
                                    disabled={loadingAction === device.sn}
                                    className="px-3 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium transition-colors"
                                >
                                    Sync Logs
                                </button>
                                <button 
                                    onClick={() => sendCommand(device.sn, 'REBOOT')}
                                    disabled={loadingAction === device.sn}
                                    className="px-3 py-2 text-sm bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 font-medium transition-colors"
                                >
                                    Reboot
                                </button>
                            </div>
                        </div>
                    );
                })}
                {devices.length === 0 && (
                    <div className="col-span-full p-8 text-center text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
                        No devices connected yet. Set up your ZKTeco ADMS to point to this server.
                    </div>
                )}
            </div>

            {editingDevice && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-4">Edit Device</h3>
                        <form onSubmit={handleSaveEdit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Device Name</label>
                                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. Front Door Scanner" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                                <input type="text" value={editBranch} onChange={e => setEditBranch(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. New York Office" />
                            </div>
                            <div className="flex space-x-3 pt-4">
                                <button type="button" onClick={() => setEditingDevice(null)} className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200">Cancel</button>
                                <button type="submit" className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
