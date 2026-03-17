// Load environment variables FIRST — before any other imports
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Robinhood OAuth state (in-memory) ──
let rhToken = process.env.RH_AUTH_TOKEN || '';       // active bearer token
let rhRefreshToken = '';                              // refresh token from login flow
let rhDeviceToken = '';                               // persistent device token for MFA
let rhLoginStatus = 'none';                          // 'none'|'logging_in'|'active'|'error'|'mfa_required'
let rhLoginError = '';                                // last error message

const rhUsername = process.env.RH_USERNAME || '';
const rhPassword = process.env.RH_PASSWORD || '';
const hasRhCredentials = !!(rhUsername && rhPassword);
const hasStaticToken = !!process.env.RH_AUTH_TOKEN;
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

// Browser-like headers for Robinhood API (matches old proxy)
const RH_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://robinhood.com',
  'Referer': 'https://robinhood.com/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"'
};

const RH_CLIENT_ID = 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS';

// ── Robinhood OAuth login using username/password ──
async function rhLogin() {
  if (!hasRhCredentials) return false;

  rhLoginStatus = 'logging_in';
  console.log('[Robinhood] Logging in with username/password...');

  if (!rhDeviceToken) {
    rhDeviceToken = crypto.randomUUID();
  }

  const body = {
    grant_type: 'password',
    scope: 'internal',
    client_id: RH_CLIENT_ID,
    device_token: rhDeviceToken,
    username: rhUsername,
    password: rhPassword,
    try_passkeys: false,
    token_request_path: '/login',
    create_read_only_secondary_token: true
  };

  const headers = {
    ...RH_BROWSER_HEADERS,
    'Content-Type': 'application/json',
    'X-Robinhood-API-Version': '1.431.4',
    'Referer': 'https://robinhood.com/login/'
  };

  try {
    const resp = await fetch('https://api.robinhood.com/oauth2/token/', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });

    const rawText = await resp.text();

    if (!resp.ok) {
      console.error(`[Robinhood] Login HTTP ${resp.status}, body: ${rawText.substring(0, 500)}`);
      let detail = 'Robinhood returned HTTP ' + resp.status;
      try {
        const errData = JSON.parse(rawText);
        detail = errData.detail || errData.message || detail;
      } catch (_) { /* non-JSON */ }
      rhLoginStatus = 'error';
      rhLoginError = detail;
      return false;
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      console.error(`[Robinhood] Login OK but non-JSON: ${rawText.substring(0, 500)}`);
      rhLoginStatus = 'error';
      rhLoginError = 'Non-JSON response from Robinhood';
      return false;
    }

    if (data.access_token) {
      rhToken = data.access_token;
      rhRefreshToken = data.refresh_token || '';
      rhLoginStatus = 'active';
      rhLoginError = '';
      console.log('[Robinhood] Login successful' + (data.expires_in ? ` (expires in ${data.expires_in}s)` : ''));

      // Schedule token refresh before expiry (refresh at 80% of lifetime)
      if (data.expires_in && rhRefreshToken) {
        const refreshMs = Math.max(data.expires_in * 0.8 * 1000, 60000);
        setTimeout(rhRefreshLoop, refreshMs);
        console.log(`[Robinhood] Token refresh scheduled in ${Math.round(refreshMs / 60000)}m`);
      }
      return true;
    }

    if (data.mfa_required || data.mfa_type) {
      rhLoginStatus = 'mfa_required';
      rhLoginError = 'MFA required — auto-login not possible. Use RH_AUTH_TOKEN instead.';
      console.warn('[Robinhood] MFA required — cannot auto-login. Set RH_AUTH_TOKEN with a pre-obtained token.');
      return false;
    }

    if (data.challenge) {
      rhLoginStatus = 'error';
      rhLoginError = 'Challenge verification required — auto-login not possible. Use RH_AUTH_TOKEN instead.';
      console.warn('[Robinhood] Challenge required — cannot auto-login. Set RH_AUTH_TOKEN with a pre-obtained token.');
      return false;
    }

    rhLoginStatus = 'error';
    rhLoginError = data.detail || 'Login failed';
    console.error('[Robinhood] Login failed:', rhLoginError);
    return false;
  } catch (e) {
    rhLoginStatus = 'error';
    rhLoginError = e.message;
    console.error('[Robinhood] Login error:', e.message);
    return false;
  }
}

// ── Refresh token flow ──
async function rhRefreshLoop() {
  if (!rhRefreshToken) return;
  console.log('[Robinhood] Refreshing token...');

  try {
    const resp = await fetch('https://api.robinhood.com/oauth2/token/', {
      method: 'POST',
      headers: {
        ...RH_BROWSER_HEADERS,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: rhRefreshToken,
        scope: 'internal',
        client_id: RH_CLIENT_ID,
        device_token: rhDeviceToken
      }),
      signal: AbortSignal.timeout(10000)
    });

    const rawText = await resp.text();
    if (!resp.ok) {
      console.error(`[Robinhood] Refresh HTTP ${resp.status}: ${rawText.substring(0, 300)}`);
      // Refresh failed — try full re-login
      console.log('[Robinhood] Refresh failed, attempting full re-login...');
      await rhLogin();
      return;
    }

    let data;
    try { data = JSON.parse(rawText); } catch (_) {
      console.error('[Robinhood] Refresh returned non-JSON');
      await rhLogin();
      return;
    }

    if (data.access_token) {
      rhToken = data.access_token;
      rhRefreshToken = data.refresh_token || rhRefreshToken;
      rhLoginStatus = 'active';
      console.log('[Robinhood] Token refreshed successfully');

      // Schedule next refresh
      if (data.expires_in) {
        const refreshMs = Math.max(data.expires_in * 0.8 * 1000, 60000);
        setTimeout(rhRefreshLoop, refreshMs);
        console.log(`[Robinhood] Next refresh in ${Math.round(refreshMs / 60000)}m`);
      }
    } else {
      console.error('[Robinhood] Refresh response missing access_token');
      await rhLogin();
    }
  } catch (e) {
    console.error('[Robinhood] Refresh error:', e.message);
    // Try full re-login on refresh failure
    await rhLogin();
  }
}

// Helper: is RH available right now?
function rhReady() {
  return !!rhToken;
}

// ── Startup logging ──
if (!hasRhCredentials && !hasStaticToken) {
  console.warn('[STARTUP] No RH credentials — set RH_USERNAME+RH_PASSWORD or RH_AUTH_TOKEN');
} else if (hasRhCredentials) {
  console.log('[STARTUP] RH_USERNAME/RH_PASSWORD found — will auto-login on startup');
} else {
  console.log('[STARTUP] RH_AUTH_TOKEN found — using static token');
}
if (!hasAnthropicKey) console.warn('[STARTUP] ANTHROPIC_API_KEY not set — /proxy/anthropic route disabled');

// ── CORS — allow configured origins (comma-separated) or all ──
// ALLOWED_ORIGIN can be a single origin or comma-separated list
// e.g. "https://planning-tool-7o36.onrender.com,https://cdiangelo.github.io"
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map(o => o.trim())
  : [];

function isOriginAllowed(origin) {
  if (!allowedOrigins.length) return true; // no restriction = allow all
  return allowedOrigins.includes(origin);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const effectiveOrigin = (origin && isOriginAllowed(origin)) ? origin : (allowedOrigins[0] || '*');

  // Always allow preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', effectiveOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }

  // Reject requests from disallowed origins (only when restrictions are configured)
  if (allowedOrigins.length && origin && !isOriginAllowed(origin)) {
    return res.status(403).json({ error: true, message: 'Origin not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', effectiveOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Body parsing ──
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting — configurable at runtime by admin ──
let rateLimitConfig = {
  globalMax: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX) || 60,
  anthropicMax: parseInt(process.env.RATE_LIMIT_ANTHROPIC_MAX) || 20,
  windowSec: parseInt(process.env.RATE_LIMIT_WINDOW_SEC) || 60,
  adminMultiplier: parseFloat(process.env.RATE_LIMIT_ADMIN_MULTIPLIER) || 3,
  retryDelays: (process.env.RATE_LIMIT_RETRY_DELAYS || '15,30,60').split(',').map(Number)
};

function createGlobalLimiter() {
  return rateLimit({
    windowMs: rateLimitConfig.windowSec * 1000,
    max: rateLimitConfig.globalMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: true, message: 'Too many requests — try again in a minute' }
  });
}
function createAnthropicLimiter() {
  return rateLimit({
    windowMs: rateLimitConfig.windowSec * 1000,
    max: rateLimitConfig.anthropicMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: true, message: `Anthropic rate limit — max ${rateLimitConfig.anthropicMax} requests per minute` }
  });
}

let globalLimiter = createGlobalLimiter();
let anthropicLimiter = createAnthropicLimiter();
// Wrap in mutable handler so we can hot-swap limiters at runtime
app.use((req, res, next) => globalLimiter(req, res, next));

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    services: {
      robinhood: rhReady(),
      anthropic: hasAnthropicKey
    },
    rh_status: rhLoginStatus,
    rh_error: rhLoginError || undefined
  });
});

// ── Robinhood set-token (paste browser token) ──
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'animalcrackers';

app.post('/proxy/robinhood/set-token', async (req, res) => {
  const { password, token } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: true, message: 'Admin password required' });
  if (!token || token.length < 10) return res.status(400).json({ error: true, message: 'Valid token required' });

  // Verify the token works by hitting a simple authenticated endpoint
  try {
    const check = await fetch('https://api.robinhood.com/accounts/', {
      headers: {
        ...RH_BROWSER_HEADERS,
        'Authorization': 'Bearer ' + token
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!check.ok) {
      const raw = await check.text();
      console.warn(`[Robinhood] Token verify failed HTTP ${check.status}: ${raw.substring(0, 300)}`);
      // Save anyway — verification endpoint may be blocked by bot detection
      rhToken = token;
      rhRefreshToken = '';
      rhLoginStatus = 'active';
      rhLoginError = '';
      console.log('[Robinhood] Token saved despite verify failure — will validate on first use');
      return res.json({ ok: true, warning: true, message: 'Token saved but could not verify (HTTP ' + check.status + '). It will be tested on first API call.' });
    }
    rhToken = token;
    rhRefreshToken = '';
    rhLoginStatus = 'active';
    rhLoginError = '';
    console.log('[Robinhood] Token set via paste — verified OK');
    return res.json({ ok: true, message: 'Token verified and saved. You are logged in.' });
  } catch (e) {
    // Network error during verify — still save the token
    rhToken = token;
    rhRefreshToken = '';
    rhLoginStatus = 'active';
    rhLoginError = '';
    console.warn('[Robinhood] Token verify network error, saving anyway:', e.message);
    return res.json({ ok: true, warning: true, message: 'Token saved but verify failed (' + e.message + '). It will be tested on first API call.' });
  }
});

// ── Robinhood status ──
app.get('/proxy/robinhood/status', (_req, res) => {
  res.json({ logged_in: rhReady(), status: rhLoginStatus });
});

// ── Robinhood Proxy ──
app.post('/proxy/robinhood', async (req, res) => {
  if (!rhReady()) {
    return res.status(503).json({
      error: true,
      message: 'Robinhood not connected',
      rh_status: rhLoginStatus,
      rh_error: rhLoginError || undefined
    });
  }

  const { endpoint, method, payload } = req.body;

  // Validate endpoint
  if (!endpoint || typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
    return res.status(400).json({ error: true, message: 'Invalid endpoint — must be a string starting with /' });
  }

  // Validate method
  const upperMethod = (method || 'GET').toUpperCase();
  if (upperMethod !== 'GET' && upperMethod !== 'POST') {
    return res.status(400).json({ error: true, message: 'Method must be GET or POST' });
  }

  const rhUrl = 'https://api.robinhood.com' + endpoint;

  try {
    const fetchOpts = {
      method: upperMethod,
      headers: {
        ...RH_BROWSER_HEADERS,
        'Authorization': 'Bearer ' + rhToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    };

    if (upperMethod === 'POST' && payload) {
      fetchOpts.body = JSON.stringify(payload);
    }

    const rhResp = await fetch(rhUrl, fetchOpts);

    // If 401, token may have expired — try refresh/re-login once
    if (rhResp.status === 401 && hasRhCredentials) {
      console.log('[RH Proxy] Got 401 — attempting token refresh...');
      const refreshed = rhRefreshToken ? await rhRefreshLoop().then(() => rhReady()) : false;
      if (!refreshed) {
        const loggedIn = await rhLogin();
        if (!loggedIn) {
          return res.status(401).json({ error: true, message: 'Robinhood session expired and re-login failed' });
        }
      }
      // Retry with new token
      fetchOpts.headers['Authorization'] = 'Bearer ' + rhToken;
      const retryResp = await fetch(rhUrl, fetchOpts);
      if (!retryResp.ok) {
        return res.status(retryResp.status).json({ error: true, status: retryResp.status, message: 'Robinhood request failed after re-auth' });
      }
      const retryData = await retryResp.json();
      return res.json(retryData);
    }

    if (!rhResp.ok) {
      return res.status(rhResp.status).json({
        error: true,
        status: rhResp.status,
        message: 'Robinhood request failed'
      });
    }

    const data = await rhResp.json();
    res.json(data);
  } catch (e) {
    console.error('[RH Proxy] Fetch error:', e.message);
    res.status(502).json({ error: true, message: 'Robinhood request failed' });
  }
});

// ── Anthropic Proxy ──
app.post('/proxy/anthropic', (req, res, next) => anthropicLimiter(req, res, next), async (req, res) => {
  if (!hasAnthropicKey) {
    return res.status(503).json({ error: true, message: 'Anthropic API key not configured on server' });
  }

  const { model, max_tokens, system, messages, tools, stream } = req.body;

  // Validate required fields
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: true, message: 'messages must be a non-empty array' });
  }
  if (!model || typeof model !== 'string') {
    return res.status(400).json({ error: true, message: 'model is required and must be a string' });
  }
  if (max_tokens !== undefined && (!Number.isInteger(max_tokens) || max_tokens <= 0)) {
    return res.status(400).json({ error: true, message: 'max_tokens must be a positive integer' });
  }

  // Build the request body to forward
  const apiBody = { model, messages };
  if (max_tokens) apiBody.max_tokens = max_tokens;
  if (system) apiBody.system = system;
  if (tools) apiBody.tools = tools;
  if (stream) apiBody.stream = true;

  try {
    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(apiBody)
    });

    if (!anthropicResp.ok) {
      const status = anthropicResp.status;
      // Forward rate-limit headers so frontend can react
      const retryAfter = anthropicResp.headers.get('retry-after');
      if (retryAfter) res.setHeader('retry-after', retryAfter);
      return res.status(status).json({
        error: true,
        status,
        message: 'Anthropic request failed'
      });
    }

    // Stream mode: pipe the SSE response through
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      anthropicResp.body.pipe(res);
      return;
    }

    // Non-stream: forward JSON response
    const data = await anthropicResp.json();
    res.json(data);
  } catch (e) {
    console.error('[Anthropic Proxy] Fetch error:', e.message);
    res.status(502).json({ error: true, message: 'Anthropic request failed' });
  }
});

// ── Admin: Get rate limit config ──
app.get('/proxy/admin/rate-limits', (req, res) => {
  res.json({
    globalMax: rateLimitConfig.globalMax,
    anthropicMax: rateLimitConfig.anthropicMax,
    windowSec: rateLimitConfig.windowSec,
    adminMultiplier: rateLimitConfig.adminMultiplier,
    retryDelays: rateLimitConfig.retryDelays
  });
});

// ── Admin: Update rate limit config ──
app.post('/proxy/admin/rate-limits', (req, res) => {
  const { password, globalMax, anthropicMax, windowSec, adminMultiplier, retryDelays } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: true, message: 'Admin password required' });

  if (globalMax !== undefined) rateLimitConfig.globalMax = Math.max(1, Math.min(1000, parseInt(globalMax) || 60));
  if (anthropicMax !== undefined) rateLimitConfig.anthropicMax = Math.max(1, Math.min(500, parseInt(anthropicMax) || 20));
  if (windowSec !== undefined) rateLimitConfig.windowSec = Math.max(10, Math.min(3600, parseInt(windowSec) || 60));
  if (adminMultiplier !== undefined) rateLimitConfig.adminMultiplier = Math.max(1, Math.min(10, parseFloat(adminMultiplier) || 3));
  if (retryDelays !== undefined && Array.isArray(retryDelays)) {
    rateLimitConfig.retryDelays = retryDelays.map(d => Math.max(1, Math.min(300, parseInt(d) || 30)));
  }

  // Hot-swap the limiters with new config
  globalLimiter = createGlobalLimiter();
  anthropicLimiter = createAnthropicLimiter();
  console.log('[Admin] Rate limits updated:', JSON.stringify(rateLimitConfig));

  res.json({ ok: true, message: 'Rate limits updated', config: rateLimitConfig });
});

// ── Start server ──
app.listen(PORT, async () => {
  console.log(`[Proxy] Server running on port ${PORT}`);
  console.log(`[Proxy] Anthropic: ${hasAnthropicKey ? 'enabled' : 'DISABLED (no key)'}`);
  if (allowedOrigins.length) {
    console.log(`[Proxy] CORS origins: ${allowedOrigins.join(', ')}`);
  } else {
    console.log('[Proxy] CORS: allowing all origins (set ALLOWED_ORIGIN for production)');
  }

  // Auto-login to Robinhood if credentials are set (and no static token already provided)
  if (hasRhCredentials && !hasStaticToken) {
    const ok = await rhLogin();
    console.log(`[Proxy] Robinhood: ${ok ? 'CONNECTED (auto-login)' : 'FAILED — ' + rhLoginError}`);
  } else if (hasStaticToken) {
    rhLoginStatus = 'active';
    console.log('[Proxy] Robinhood: enabled (static token)');
  } else {
    console.log('[Proxy] Robinhood: DISABLED (no credentials)');
  }
});
