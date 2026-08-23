'use client';
import { useEffect, useState } from 'react';

export default function DevicesPage() {
    const [devices, setDevices] = useState<any[]>([]);

    useEffect(() => {
        const fetchDevices = async () => {
            try {
                const res = await fetch('/api/devices');
                const data = await res.json();
                setDevices(Array.isArray(data) ? data : []);
            } catch (err) {
                setDevices([]);
            }
        };
        fetchDevices();
    }, []);

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Connected Devices</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {devices.map(device => {
                    const lastActive = new Date(device.last_active);
                    const isOnline = (new Date().getTime() - lastActive.getTime()) < 5 * 60 * 1000; // 5 mins threshold
                    return (
                        <div key={device.sn} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="font-bold text-lg">{device.name || 'Unnamed Device'}</h3>
                                    <p className="text-gray-500 text-sm">SN: {device.sn}</p>
                                </div>
                                <span className={`flex items-center space-x-1 text-sm font-medium ${isOnline ? 'text-green-600' : 'text-red-500'}`}>
                                    <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-600' : 'bg-red-500'}`}></span>
                                    <span>{isOnline ? 'Online' : 'Offline'}</span>
                                </span>
                            </div>
                            <div className="text-sm text-gray-500 space-y-1">
                                <p>IP Address: {device.ip_address || 'Unknown'}</p>
                                <p>Last Sync: {lastActive.toLocaleString()}</p>
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
