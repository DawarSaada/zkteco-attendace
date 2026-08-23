import Link from 'next/link';
import { LayoutDashboard, Activity, FileSpreadsheet, MonitorSmartphone } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-200 font-bold text-xl text-blue-600">
          ZKTeco Admin
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <Link href="/dashboard" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700">
            <LayoutDashboard size={20} />
            <span>Overview</span>
          </Link>
          <Link href="/dashboard/live" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700">
            <Activity size={20} />
            <span>Live Monitor</span>
          </Link>
          <Link href="/dashboard/reports" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700">
            <FileSpreadsheet size={20} />
            <span>Reports</span>
          </Link>
          <Link href="/dashboard/devices" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700">
            <MonitorSmartphone size={20} />
            <span>Devices</span>
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-8">
          <h1 className="text-xl font-semibold">Dashboard</h1>
        </header>
        <div className="p-8 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
