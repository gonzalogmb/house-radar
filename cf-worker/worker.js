/**
 * The real access-control boundary for house-radar's static demo.
 *
 * docs/ (GitHub Pages) has no server of its own, so every *write* action —
 * dispatching the scrape workflow, adding or removing a saved search — is
 * routed through this Worker instead of going straight to GitHub's API from
 * the browser. That's the whole point of it: a GitHub token good enough to
 * write to the repo (GITHUB_TOKEN) lives ONLY in this Worker's secrets,
 * never in a browser, never in localStorage, never in the page's source.
 *
 * Sign-in is "Login with GitHub" (a separate, much less powerful credential):
 * the browser gets an authorization `code` from GitHub's own login page,
 * this Worker exchanges it server-side for a short-lived access token (that
 * exchange needs GH_OAUTH_CLIENT_SECRET, which is why it can't happen in the
 * browser), and hands that access token back to the page to use as its
 * "credential" on write calls. That token only ever proves who's asking —
 * it was requested with `scope=read:user` and can't write anything on
 * GitHub by itself. On every write request this Worker calls GitHub's own
 * `/user` endpoint with it to check the login is exactly ALLOWED_LOGIN,
 * and only then reaches for GITHUB_TOKEN to actually act. Reads (the
 * saved-search list, run history, data.json) stay direct, unauthenticated
 * calls from the browser to GitHub's public API — there's nothing to
 * protect there, so they don't go through this Worker at all.
 *
 * Deploy: see the "Login con GitHub" section in README.md.
 */

const GH_OWNER = "gonzalogmb";
const GH_REPO = "house-radar";
const GH_WORKFLOW = "daily-scrape.yml";
const ALLOWED_LOGIN = "gonzalogmb";
const GH_API = "https://api.github.com";

async function githubRequest(env, path, options = {}) {
  return fetch(`${GH_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "house-radar-gate-worker",
      ...(options.headers || {}),
    },
  });
}

/** Who does this access token belong to, according to GitHub itself? */
async function githubLogin(accessToken) {
  const response = await fetch(`${GH_API}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "house-radar-gate-worker",
    },
  });
  if (!response.ok) throw new Error("invalid or expired GitHub session");
  const user = await response.json();
  return user.login;
}

/** Step 1 of login: trade the one-time `code` from GitHub's redirect for an access token. */
async function exchangeCodeForToken(env, code) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GH_OAUTH_CLIENT_ID,
      client_secret: env.GH_OAUTH_CLIENT_SECRET,
      code,
    }),
  });
  const data = await response.json();
  if (!data.access_token) {
    throw new Error(data.error_description || "GitHub no devolvió un token de acceso");
  }
  return data.access_token;
}

/** Every write endpoint calls this first — throws unless the caller really is ALLOWED_LOGIN. */
async function requireOwner(request) {
  const body = await request.json();
  const login = await githubLogin(body.credential);
  if (login !== ALLOWED_LOGIN) {
    throw new Error(`not authorized: signed in as ${login}`);
  }
  return body;
}

function encodeBase64(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}

function decodeBase64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

async function readSearchesFile(env) {
  const response = await githubRequest(env, `/repos/${GH_OWNER}/${GH_REPO}/contents/site/searches.json?ref=main`);
  if (!response.ok) throw new Error(`could not read searches.json (${response.status})`);
  const data = await response.json();
  return { sha: data.sha, searches: JSON.parse(decodeBase64(data.content)) };
}

async function writeSearchesFile(env, searches, sha, message) {
  const response = await githubRequest(env, `/repos/${GH_OWNER}/${GH_REPO}/contents/site/searches.json`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: encodeBase64(JSON.stringify(searches, null, 2) + "\n"),
      sha,
      branch: "main",
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`could not write searches.json (${response.status}): ${text.slice(0, 200)}`);
  }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://radar.gonzalomartinezberzal.com";
    const headers = { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const { pathname } = new URL(request.url);

    try {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers });
      }

      if (pathname === "/auth/callback") {
        const { code } = await request.json();
        const accessToken = await exchangeCodeForToken(env, code);
        const login = await githubLogin(accessToken);
        return new Response(JSON.stringify({ access_token: accessToken, login }), { headers });
      }

      if (pathname === "/dispatch") {
        const body = await requireOwner(request);
        const response = await githubRequest(
          env,
          `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`,
          {
            method: "POST",
            body: JSON.stringify({ ref: "main", inputs: body.search_name ? { search_name: body.search_name } : {} }),
          },
        );
        if (response.status !== 204) {
          const text = await response.text();
          return new Response(JSON.stringify({ error: `GitHub respondió ${response.status}: ${text.slice(0, 200)}` }), {
            status: 502,
            headers,
          });
        }
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      if (pathname === "/searches/add") {
        const body = await requireOwner(request);
        const { sha, searches } = await readSearchesFile(env);
        searches.push(body.search);
        await writeSearchesFile(env, searches, sha, `Add search: ${body.search.name}`);
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      if (pathname === "/searches/delete") {
        const body = await requireOwner(request);
        const { sha, searches } = await readSearchesFile(env);
        const remaining = searches.filter((search) => search.name !== body.name);
        await writeSearchesFile(env, remaining, sha, `Remove search: ${body.name}`);
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 403, headers });
    }
  },
};
