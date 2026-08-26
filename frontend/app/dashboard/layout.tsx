import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { NavProvider } from '@/components/NavContext';
import { logout } from '@/app/login/actions';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  async function handleLogout() {
    'use server';
    await logout();
  }

  return (
    <NavProvider>
      <div className="min-h-screen flex bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 transition-colors duration-200">
        {/* 1. Sidebar Navigation (Desktop fixed + Mobile slide-out drawer) */}
        <Sidebar userEmail={user.email} onLogout={handleLogout} />

        {/* 2. Main Viewport Area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-x-hidden">
          <Header />
          <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6">
            {children}
          </main>
        </div>
      </div>
    </NavProvider>
  );
}
