'use client';
import { useEffect, useState } from 'react';

export default function DashboardOverview() {
    const [stats, setStats] = useState({ devices: 0, employees: 0 });

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [devicesRes, employeesRes] = await Promise.all([
                    fetch('/api/devices'),
                    fetch('/api/employees')
                ]);
                const devices = await devicesRes.json();
                const employees = await employeesRes.json();
                setStats({ 
                    devices: Array.isArray(devices) ? devices.length : 0, 
                    employees: Array.isArray(employees) ? employees.length : 0 
                });
            } catch (err) {
                setStats({ devices: 0, employees: 0 });
            }
        };
        fetchData();
    }, []);

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <p className="text-gray-500 text-sm font-medium">Total Devices</p>
                    <p className="text-3xl font-bold mt-2">{stats.devices}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <p className="text-gray-500 text-sm font-medium">Enrolled Employees</p>
                    <p className="text-3xl font-bold mt-2">{stats.employees}</p>
                </div>
            </div>
        </div>
    );
}
