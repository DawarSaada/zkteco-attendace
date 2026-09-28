import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/auth/roles';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { NavProvider } from '@/components/NavContext';
import { Backdrop } from '@/components/ui/Backdrop';
import { SkipLink } from '@/components/SkipLink';
import { logout } from '@/app/login/actions';

const MAIN_ID = 'dashboard-main';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // The nav is rendered per role so a viewer is not shown screens that will
  // answer 403. The server-side checks remain the source of truth.
  const profile = await getProfile(supabase, user);

  async function handleLogout() {
    'use server';
    await logout();
  }

  return (
    <NavProvider>
      <Backdrop />
      <SkipLink targetId={MAIN_ID} />
      <div className="text-ink relative flex min-h-screen">
        {/* Desktop sidebar / mobile off-canvas drawer */}
        <Sidebar userEmail={user.email} role={profile.role} onLogout={handleLogout} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Header />
          <main
            id={MAIN_ID}
            tabIndex={-1}
            className="animate-in fade-in mx-auto w-full max-w-[84rem] flex-1 space-y-6 p-4 outline-none duration-300 sm:p-6 md:p-8"
          >
            {children}
          </main>
        </div>
      </div>
    </NavProvider>
  );
}
