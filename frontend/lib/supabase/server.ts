import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch (error) {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

/**
 * Admin client using the service role key.
 * Use this in API route handlers to bypass RLS and always read/write data.
 *
 * This deliberately does NOT fall back to the anon key. It used to, which meant a
 * missing/misspelled `SUPABASE_SERVICE_ROLE_KEY` (an extremely common deployment
 * error) silently downgraded every API route to the anonymous role. That used to
 * "work" only because RLS was wide open; now that it is not, the downgrade would
 * fail in confusing ways. Failing loudly is the correct behaviour.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL. See .env.example.')
  }
  if (!key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY. Server-side data access requires the service role key; ' +
        'the anon key is not an acceptable fallback (see PRODUCTION_READINESS.md B7). See .env.example.',
    )
  }

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
