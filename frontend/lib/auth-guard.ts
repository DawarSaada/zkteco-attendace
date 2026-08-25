import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { User } from '@supabase/supabase-js';

export interface AuthResult {
    user: User | null;
    response: NextResponse | null;
}

/**
 * Server-side authentication guard for Next.js Route Handlers.
 * Returns { user, response: null } if authenticated,
 * or { user: null, response: 401 NextResponse } if unauthenticated.
 */
export async function requireAuthUser(): Promise<AuthResult> {
    try {
        const supabase = await createClient();
        const { data: { user }, error } = await supabase.auth.getUser();

        if (error || !user) {
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
