import { createHandler, createRestDb } from './handler.mjs';

// Deploy with verify_jwt=false: app_sessions tokens are verified inside the handler.
const db = createRestDb({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
});
Deno.serve(createHandler({ db }));
