import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

/** When false, the app uses localStorage only; DB/realtime calls are skipped in hooks. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// createClient throws on empty URL/key; placeholders keep the module loadable for offline/local use.
const clientUrl = isSupabaseConfigured ? supabaseUrl : "https://placeholder-not-configured.invalid";
const clientKey = isSupabaseConfigured
  ? supabaseAnonKey
  : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.not-configured";

export const supabase = createClient(clientUrl, clientKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
