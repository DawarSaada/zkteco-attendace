import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * The identity the API works from. Deliberately narrower than Supabase's `User`
 * — only the two fields anything reads — so the guard can be satisfied by a
 * locally verified JWT instead of a round trip to the Auth server.
 */
export interface AuthUser {
    id: string;
    email?: string;
}

export interface AuthResult {
    user: AuthUser | null;
    response: NextResponse | null;
}

/**
 * Verify a request's session and return its identity, or null.
 *
 * `getClaims()` rather than `getUser()`: this project signs JWTs with asymmetric
 * keys (ES256), so supabase-js verifies the signature locally against the cached
 * JWKS and still rejects a tampered or expired token (one that is about to
 * expire is refreshed first). `getUser()` costs a full round trip to the Auth
 * server on *every* authenticated request, which is the largest single part of
 * an API call on this deployment — the database lives in ap-south-1 and each hop
 * is milliseconds there but ~200ms from another region.
 *
 * A project still on the legacy symmetric secret transparently falls back to the
 * Auth server inside `getClaims()`, so this is correct either way.
 */
export async function getVerifiedUser(supabase: SupabaseClient): Promise<AuthUser | null> {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as { sub?: unknown; email?: unknown } | undefined;

    if (error || !claims || typeof claims.sub !== 'string') return null;

    return {
        id: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : undefined,
    };
}

/**
 * Server-side authentication guard for Next.js Route Handlers.
 * Returns { user, response: null } if authenticated,
 * or { user: null, response: 401 NextResponse } if unauthenticated.
 */
export async function requireAuthUser(): Promise<AuthResult> {
    try {
        const supabase = await createClient();
        const user = await getVerifiedUser(supabase);

        if (!user) {
            return {
                user: null,
                response: NextResponse.json(
                    { error: 'Unauthorized: Valid user session required.' },
                    { status: 401 }
                ),
            };
        }

        return { user, response: null };
    } catch {
        return {
            user: null,
            response: NextResponse.json(
                { error: 'Unauthorized: Authentication check failed.' },
                { status: 401 }
            ),
        };
    }
}

/**
 * Safe error message extractor for catch (error: unknown) blocks.
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as { message: unknown }).message);
    }
    return 'An unexpected error occurred';
}
