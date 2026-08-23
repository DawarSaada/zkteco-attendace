import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LayoutDashboard, Activity, FileSpreadsheet, MonitorSmartphone, Users, LogOut } from 'lucide-react';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

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
          <Link href="/dashboard/employees" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700">
            <Users size={20} />
            <span>Employees</span>
          </Link>
          <Link href="/dashboard/shifts" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700">
            <FileSpreadsheet size={20} />
            <span>Shifts</span>
          </Link>
          <Link href="/dashboard/devices" className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-700">
            <MonitorSmartphone size={20} />
            <span>Devices</span>
          </Link>
        </nav>
        
        <div className="p-4 border-t border-gray-200">
          <form action="/login/actions" method="POST">
             <button 
                formAction={async () => {
                  "use server";
                  const { logout } = await import('@/app/login/actions');
                  await logout();
                }}
                className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-red-600 hover:bg-red-50 font-medium"
              >
                <LogOut size={20} />
                <span>Sign Out</span>
             </button>
          </form>
        </div>
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
