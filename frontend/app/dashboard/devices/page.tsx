'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export default function DevicesPage() {
    const [devices, setDevices] = useState<any[]>([]);
    const [loadingAction, setLoadingAction] = useState<string>('');
    const supabase = createClient();

    useEffect(() => {
        const fetchDevices = async () => {
            const res = await fetch('/api/devices');
            const data = await res.json();
            setDevices(Array.isArray(data) ? data : []);
        };
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
            alert('Command queued successfully. The device will execute it on its next heartbeat.');
        } catch (err) {
            alert('Failed to queue command.');
        } finally {
            setLoadingAction('');
        }
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
                                    </div>
                                    <span className={`flex items-center space-x-1 text-sm font-medium px-2 py-1 rounded-full ${isOnline ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                        <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-600' : 'bg-red-500'}`}></span>
                                        <span>{isOnline ? 'Online' : 'Offline'}</span>
                                    </span>
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
        </div>
    );
}
