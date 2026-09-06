/**
 * The real access-control boundary for house-radar's static demo.
 *
 * docs/ (GitHub Pages) has no server of its own, so every *write* action —
 * dispatching the scrape workflow, adding or removing a saved search — is
 * routed through this Worker instead of going straight to GitHub's API from
 * the browser. That's the whole point of it: a GitHub token good enough to
 * write to the repo lives ONLY in this Worker's secrets, never in a browser,
 * never in localStorage, never in the page's source. A visitor's browser
 * only ever holds a short-lived Google ID token, which proves who they
 * signed in as — it grants nothing on GitHub by itself.
 *
 * Every write request must carry a Google ID token (`credential`) that this
 * Worker verifies itself: signature against Google's own public keys,
 * issuer, audience, expiry, and that the verified email is an exact match
 * for ALLOWED_EMAIL. Only then does it use its own GITHUB_TOKEN secret to
 * act on GitHub. Reads (the saved-search list, run history, data.json) stay
 * direct, unauthenticated calls from the browser to GitHub's public API —
 * there's nothing to protect there, so they don't go through this Worker.
 *
 * Deploy: see the "Login con Google" section in README.md.
 */

const GH_OWNER = "gonzalogmb";
const GH_REPO = "house-radar";
const GH_WORKFLOW = "daily-scrape.yml";
const ALLOWED_EMAIL = "gonzalogmb@gmail.com";
const GH_API = "https://api.github.com";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

let jwksCache = null;
let jwksCachedAt = 0;

async function fetchGoogleJwks() {
  if (jwksCache && Date.now() - jwksCachedAt < 3600_000) return jwksCache;
  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) throw new Error("could not fetch Google's public keys");
  jwksCache = await response.json();
  jwksCachedAt = Date.now();
  return jwksCache;
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToString(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

/** Verifies a Google ID token end to end and returns its payload — throws on anything wrong. */
async function verifyGoogleIdToken(idToken, expectedAudience) {
  if (!idToken || typeof idToken !== "string") throw new Error("missing credential");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64UrlToString(headerB64));
  const payload = JSON.parse(base64UrlToString(payloadB64));

  if (header.alg !== "RS256") throw new Error("unexpected algorithm");
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new Error("unexpected issuer");
  }
  if (payload.aud !== expectedAudience) throw new Error("unexpected audience");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) throw new Error("token expired");

  const jwks = await fetchGoogleJwks();
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("unknown signing key");

  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ]);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
  if (!valid) throw new Error("bad signature");

  return payload;
}

async function requireOwner(request, env) {
  const body = await request.json();
  const payload = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  if (!payload.email_verified || payload.email !== ALLOWED_EMAIL) {
    throw new Error(`not authorized: signed in as ${payload.email ?? "unknown"}`);
  }
  return body;
}

function encodeBase64(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}

function decodeBase64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

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

      if (pathname === "/dispatch") {
        const body = await requireOwner(request, env);
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
        const body = await requireOwner(request, env);
        const { sha, searches } = await readSearchesFile(env);
        searches.push(body.search);
        await writeSearchesFile(env, searches, sha, `Add search: ${body.search.name}`);
        return new Response(JSON.stringify({ ok: true }), { headers });
      }

      if (pathname === "/searches/delete") {
        const body = await requireOwner(request, env);
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
