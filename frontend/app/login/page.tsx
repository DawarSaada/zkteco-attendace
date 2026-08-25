import { login } from './actions';
import { Fingerprint, Lock, Mail, ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const resolvedSearchParams = await searchParams;
  
  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100 p-6 transition-colors duration-200">
      {/* Header with Theme Toggle */}
      <div className="flex justify-between items-center max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
            <Fingerprint size={18} />
          </div>
          <span className="font-bold text-sm tracking-tight text-slate-800 dark:text-slate-200">
            BioTime <span className="text-blue-600 dark:text-blue-400 font-semibold text-xs px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/50">Pro</span>
          </span>
        </div>
        <ThemeToggle />
      </div>

      {/* Login Card */}
      <div className="w-full max-w-md mx-auto my-auto bg-white dark:bg-[#0c121e] p-8 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800/80 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center mx-auto mb-2">
            <Lock size={22} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Manager Sign In
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Dawar Al-Saada Attendance System Portal
          </p>
        </div>
        
        <form className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" htmlFor="email">
              Email Address
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="admin@example.com"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="password"
                name="password"
                type="password"
                required
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="••••••••"
              />
            </div>
          </div>

          {resolvedSearchParams?.error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60 p-3 rounded-xl border border-red-200 dark:border-red-800/80 font-medium">
              {resolvedSearchParams.error}
            </p>
          )}

          <button
            formAction={login}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl shadow-sm shadow-blue-500/20 transition-all text-sm cursor-pointer mt-2"
          >
            Sign In to Dashboard
          </button>
        </form>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-slate-400 dark:text-slate-600 pb-2">
        Protected by Server-Side Session Guard &bull; ZKTeco Push ADMS
      </div>
    </div>
  );
}
