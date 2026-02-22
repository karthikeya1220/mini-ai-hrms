import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV !== 'test') {
        console.warn('[supabase] WARNING: SUPABASE_URL or SUPABASE_ANON_KEY not set. Auth will fail.');
    }
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
