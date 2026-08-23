// Forwards TMDB API requests with a server-held key, so the browser never
// sees or needs its own TMDB token. Supabase verifies the caller's JWT
// (anon key or a signed-in user's session) before this runs, so it isn't
// open to the wider internet.
//
// Deploy: supabase functions deploy tmdb-proxy
// Configure once:  supabase secrets set TMDB_READ_ACCESS_TOKEN=<your token>
//
// Call from the client as:
//   /functions/v1/tmdb-proxy/movie/550?language=en-US
// which forwards to:
//   https://api.themoviedb.org/3/movie/550?language=en-US

const TMDB_BASE = 'https://api.themoviedb.org/3';
const FUNCTION_PREFIX = '/tmdb-proxy';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = Deno.env.get('TMDB_READ_ACCESS_TOKEN');
  if (!token) {
    return new Response(JSON.stringify({ error: 'TMDB_READ_ACCESS_TOKEN is not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  let tmdbPath = url.pathname;
  if (tmdbPath.startsWith(FUNCTION_PREFIX)) {
    tmdbPath = tmdbPath.slice(FUNCTION_PREFIX.length);
  }
  if (!tmdbPath.startsWith('/')) tmdbPath = '/' + tmdbPath;

  const target = new URL(TMDB_BASE + tmdbPath);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const tmdbRes = await fetch(target.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  const body = await tmdbRes.text();
  return new Response(body, {
    status: tmdbRes.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
