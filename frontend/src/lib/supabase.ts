import { createClient } from "@supabase/supabase-js";

// Single anonymous client — works in Server Components, Server Actions,
// Route Handlers, and Client Components alike.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
