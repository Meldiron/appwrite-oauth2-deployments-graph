// OIDC Authorization Code + PKCE flow for the Appwrite Console OAuth2 server.
// Public client (no secret), S256 code challenge.

const API_ENDPOINT = 'https://cloud.appwrite.io/v1'
const CONSOLE_PROJECT_ID = 'console'
const DISCOVERY_URL = `${API_ENDPOINT}/oauth2/${CONSOLE_PROJECT_ID}/.well-known/openid-configuration`

export const CLIENT_ID = 'appwriter-graph'
// Derive the redirect URI from whatever origin the app is currently served on,
// so it works across localhost, preview, and production without code changes.
export const REDIRECT_URI = `${window.location.origin}/redirect`
export const SCOPES = 'openid project:functions.read project:sites.read'

const STORAGE = {
  verifier: 'aw_pkce_verifier',
  state: 'aw_oauth_state',
  token: 'aw_access_token',
}

// ---- discovery ------------------------------------------------------------

let _config = null
export async function getConfig() {
  if (_config) return _config
  const res = await fetch(DISCOVERY_URL)
  if (!res.ok) throw new Error(`Failed to load OIDC discovery (${res.status})`)
  _config = await res.json()
  return _config
}

// ---- PKCE helpers ---------------------------------------------------------

function base64url(bytes) {
  let str = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(length = 64) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

async function sha256Challenge(verifier) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64url(digest)
}

// ---- flow -----------------------------------------------------------------

export async function login() {
  const cfg = await getConfig()
  const verifier = randomString(64)
  const state = randomString(16)
  sessionStorage.setItem(STORAGE.verifier, verifier)
  sessionStorage.setItem(STORAGE.state, state)

  const challenge = await sha256Challenge(verifier)
  const url = new URL(cfg.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Force the consent screen on every sign-in instead of silently reusing the
  // remembered grant for this client.
  url.searchParams.set('prompt', 'consent')
  window.location.assign(url.toString())
}

// Exchange the authorization code (from the /redirect URL) for tokens.
export async function handleRedirect() {
  const params = new URLSearchParams(window.location.search)
  const error = params.get('error')
  if (error) {
    throw new Error(params.get('error_description') || error)
  }

  const code = params.get('code')
  const state = params.get('state')
  if (!code) throw new Error('Missing authorization code in redirect.')

  const expectedState = sessionStorage.getItem(STORAGE.state)
  if (!state || state !== expectedState) {
    throw new Error('State mismatch — possible CSRF, aborting.')
  }

  const verifier = sessionStorage.getItem(STORAGE.verifier)
  if (!verifier) throw new Error('Missing PKCE verifier — please sign in again.')

  const cfg = await getConfig()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  })

  const res = await fetch(cfg.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }
  const tokens = await res.json()

  // Clean up one-time PKCE state.
  sessionStorage.removeItem(STORAGE.verifier)
  sessionStorage.removeItem(STORAGE.state)
  sessionStorage.setItem(STORAGE.token, tokens.access_token)

  return tokens
}

export function getStoredToken() {
  return sessionStorage.getItem(STORAGE.token)
}

export function logout() {
  sessionStorage.removeItem(STORAGE.token)
}

// ---- accessible projects --------------------------------------------------

// Max page size accepted by the endpoint (APP_LIMIT_SUBQUERY server-side).
const PROJECTS_PAGE = 100

// Resolve the projects the access token can see by calling the console
// `listProjects` endpoint, expanding the token's `project` authorization
// details (including the `*` wildcard) into concrete project IDs. Paginates
// with limit/offset until the reported total is reached.
export async function fetchProjectIds(accessToken) {
  const ids = []
  let offset = 0
  for (;;) {
    const url = new URL(`${API_ENDPOINT}/oauth2/${CONSOLE_PROJECT_ID}/projects`)
    url.searchParams.set('limit', String(PROJECTS_PAGE))
    url.searchParams.set('offset', String(offset))

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Appwrite-Project': CONSOLE_PROJECT_ID,
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to list accessible projects (${res.status}): ${text}`)
    }

    const data = await res.json()
    const batch = data.projects || []
    for (const p of batch) ids.push(p.$id)

    offset += batch.length
    const total = data.total ?? ids.length
    if (batch.length === 0 || offset >= total) break
  }
  return ids
}
