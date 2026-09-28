import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/session'

/**
 * Request proxy (the Next.js 16 rename of `middleware.ts`) — see
 * PRODUCTION_READINESS.md B6.
 *
 * Responsibilities: refresh the Supabase session cookie, and bounce
 * unauthenticated *page* requests to `/login` so any route added outside
 * `/dashboard` is protected by default instead of by remembering to check.
 *
 * The matcher MUST keep excluding the machine-to-machine paths. ZKTeco terminals
 * speak to `/iclock/*` and Vercel Cron calls `/api/cron/*`; neither carries a
 * session cookie, so redirecting them would break device ingestion and the
 * monthly payroll mailout.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next|favicon.ico|icon.svg|api/iclock|iclock|api/cron).*)',
  ],
}
