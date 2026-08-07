// lib/supabase-admin.ts
// Client Supabase utilisé UNIQUEMENT côté serveur (routes API, cron).
// Utilise la service_role key : contourne le RLS, ne JAMAIS exposer côté client.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Variables SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes');
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
