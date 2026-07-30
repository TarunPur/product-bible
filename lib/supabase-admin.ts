import { createClient } from '@supabase/supabase-js'

// Service-role client for server-only code (API route, ingestion, eval scripts).
// There's no user login in this app, so there's no browser/cookie-based client —
// all Supabase access is server-side against a single shared dataset.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
