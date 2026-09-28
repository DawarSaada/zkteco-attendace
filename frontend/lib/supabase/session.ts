import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the Supabase session on every matched request.
 *
 * Why this exists (see PRODUCTION_READINESS.md B6): Supabase access tokens live
 * about an hour and the refresh-token rotation only happens where cookies can be
 * written. Without middleware nothing renewed the session — `createClient()` in
 * `server.ts` cannot set cookies from a Server Component, so it swallows that
 * error and users were silently bounced to `/login` roughly hourly.
 *
 * Two rules that matter:
 *   1. Never redirect `/api/*`. Route handlers authenticate themselves and must
 *      answer with JSON 401, not an HTML login page.
 *   2. `/api/iclock`, `/iclock` and `/api/cron/*` are excluded in the matcher —
 *      ZKTeco terminals and Vercel cron have no session cookie and would
 *      otherwise be redirected, breaking device ingestion.
 */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // A misconfigured deployment should surface its own error rather than being
  // funnelled into an infinite /login redirect loop.
  if (!url || !anonKey) {
    console.error('Middleware: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set; skipping session refresh.')
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // Do not put logic between createServerClient and auth.getUser(): the refresh
  // write above depends on this call happening first.
  let user = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error && error.message !== 'Auth session missing!') {
      console.warn('Middleware Supabase session check failed:', error.message)
    }
    user = data.user
  } catch (error) {
    console.error('Middleware Supabase error:', error)
  }

  const { pathname } = request.nextUrl
  const isApiRoute = pathname.startsWith('/api')

  if (!user && !isApiRoute && !pathname.startsWith('/login') && !pathname.startsWith('/auth')) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    return NextResponse.redirect(loginUrl)
  }

  return response
}
