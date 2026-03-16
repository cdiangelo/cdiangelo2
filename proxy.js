// ADDED — Phase 1: Local CORS proxy server
// Replaces dependency on api.allorigins.win
// Start: node proxy.js — listens on port 3001

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

// ── AI API key: held server-side only, never sent to browser ──
const ADMIN_PASSWORD = 'animalcrackers'; // Must match workspace.html
let storedApiKey = process.env.ANTHROPIC_API_KEY || '';

// In-memory cache: Map<url, {data, ts, contentType}>
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(url) {
  const entry = cache.get(url);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry;
  if (entry) cache.delete(url);
  return null;
}

function setCache(url, data, contentType) {
  cache.set(url, { data, ts: Date.now(), contentType });
}

// Parse JSON bodies for POST endpoints
app.use(express.json({ limit: '1mb' }));

// CORS middleware — allow all origins (local dev only)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// GET /proxy/yahoo?url=<encoded_url> → forwards to Yahoo Finance, returns JSON
app.get('/proxy/yahoo', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: true, source: 'proxy', status: 400, url: '', message: 'Missing url parameter' });

  const cached = getCached(url);
  if (cached) {
    res.setHeader('Content-Type', 'application/json');
    return res.send(cached.data);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, source: 'upstream', status: resp.status, url });
    }
    const data = await resp.text();
    setCache(url, data, 'application/json');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (e) {
    res.status(502).json({ error: true, source: 'upstream', status: 502, url, message: e.message });
  }
});

// GET /proxy/news?url=<encoded_url> → forwards to Google News RSS, returns raw XML
app.get('/proxy/news', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: true, source: 'proxy', status: 400, url: '', message: 'Missing url parameter' });

  const cached = getCached(url);
  if (cached) {
    res.setHeader('Content-Type', 'application/xml');
    return res.send(cached.data);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: true, source: 'upstream', status: resp.status, url });
    }
    const data = await resp.text();
    setCache(url, data, 'application/xml');
    res.setHeader('Content-Type', 'application/xml');
    res.send(data);
  } catch (e) {
    res.status(502).json({ error: true, source: 'upstream', status: 502, url, message: e.message });
  }
});

// ═══════════════════════════════════════════
// AI PROXY — API key held server-side only
// ═══════════════════════════════════════════

// POST /proxy/ai/key — Admin sets the API key (password-protected)
app.post('/proxy/ai/key', (req, res) => {
  const { password, apiKey } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: true, message: 'Invalid admin password' });
  }
  if (!apiKey || !apiKey.startsWith('sk-')) {
    return res.status(400).json({ error: true, message: 'Invalid API key format' });
  }
  storedApiKey = apiKey;
  console.log('[AI Proxy] API key updated by admin (last 4: ...' + apiKey.slice(-4) + ')');
  res.json({ ok: true, message: 'API key stored on server', last4: apiKey.slice(-4) });
});

// GET /proxy/ai/status — Check if API key is configured (no key exposed)
app.get('/proxy/ai/status', (req, res) => {
  res.json({
    configured: !!storedApiKey,
    last4: storedApiKey ? '...' + storedApiKey.slice(-4) : null
  });
});

// POST /proxy/ai/messages — Proxy to Anthropic Messages API (streaming supported)
app.post('/proxy/ai/messages', async (req, res) => {
  if (!storedApiKey) {
    return res.status(503).json({ error: true, message: 'API key not configured. Admin must set it first.' });
  }

  const body = req.body;
  if (!body || !body.model || !body.messages) {
    return res.status(400).json({ error: true, message: 'Missing model or messages in request body' });
  }

  try {
    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': storedApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      return res.status(anthropicResp.status).json({
        error: true,
        source: 'anthropic',
        status: anthropicResp.status,
        message: errText.substring(0, 500)
      });
    }

    // If streaming, pipe the response directly
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      // Pipe the raw SSE stream from Anthropic to the client
      const reader = anthropicResp.body;
      reader.pipe(res);
      reader.on('end', () => res.end());
      reader.on('error', (err) => {
        console.error('[AI Proxy] Stream error:', err.message);
        res.end();
      });
    } else {
      // Non-streaming: forward JSON response
      const data = await anthropicResp.json();
      res.json(data);
    }
  } catch (e) {
    console.error('[AI Proxy] Error:', e.message);
    res.status(502).json({ error: true, source: 'proxy', message: e.message });
  }
});

// ═══════════════════════════════════════════
// ROBINHOOD PROXY — Tier 1 (public) & Tier 2 (auth)
// ═══════════════════════════════════════════

let rhToken = ''; // Robinhood OAuth token (set via login)
let rhRefreshToken = '';
let rhDeviceToken = ''; // persistent device token for MFA

// GET /proxy/robinhood?endpoint=<path> — Public Robinhood API (no auth)
app.get('/proxy/robinhood', async (req, res) => {
  const endpoint = req.query.endpoint;
  if (!endpoint) return res.status(400).json({ error: true, message: 'Missing endpoint parameter' });

  const url = 'https://api.robinhood.com/' + endpoint;
  const cached = getCached('rh:' + url);
  if (cached) {
    res.setHeader('Content-Type', 'application/json');
    return res.send(cached.data);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return res.status(resp.status).json({ error: true, source: 'robinhood', status: resp.status });
    const data = await resp.text();
    setCache('rh:' + url, data, 'application/json');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (e) {
    res.status(502).json({ error: true, source: 'robinhood', message: e.message });
  }
});

// GET /proxy/robinhood/auth?endpoint=<path> — Authenticated Robinhood API (Tier 2)
app.get('/proxy/robinhood/auth', async (req, res) => {
  const endpoint = req.query.endpoint;
  if (!endpoint) return res.status(400).json({ error: true, message: 'Missing endpoint parameter' });
  if (!rhToken) return res.status(401).json({ error: true, message: 'Not logged in to Robinhood' });

  const url = 'https://api.robinhood.com/' + endpoint;
  const cacheKey = 'rh-auth:' + url;
  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'application/json');
    return res.send(cached.data);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + rhToken,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      if (resp.status === 401) {
        // Try token refresh
        const refreshed = await refreshRobinhoodToken();
        if (refreshed) {
          const retryResp = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + rhToken, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000)
          });
          if (retryResp.ok) {
            const data = await retryResp.text();
            setCache(cacheKey, data, 'application/json');
            res.setHeader('Content-Type', 'application/json');
            return res.send(data);
          }
        }
        rhToken = '';
        return res.status(401).json({ error: true, message: 'Session expired. Please log in again.' });
      }
      return res.status(resp.status).json({ error: true, source: 'robinhood', status: resp.status });
    }
    const data = await resp.text();
    setCache(cacheKey, data, 'application/json');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (e) {
    res.status(502).json({ error: true, source: 'robinhood', message: e.message });
  }
});

// POST /proxy/robinhood/login — Login to Robinhood (username/password + optional MFA)
app.post('/proxy/robinhood/login', async (req, res) => {
  const { username, password, mfa_code, challenge_id } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: true, message: 'Username and password required' });

  if (!rhDeviceToken) {
    const crypto = require('crypto');
    rhDeviceToken = crypto.randomUUID();
  }

  const body = {
    grant_type: 'password',
    scope: 'internal',
    client_id: 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
    device_token: rhDeviceToken,
    username,
    password
  };
  if (mfa_code) body.mfa_code = mfa_code;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json',
    'X-Robinhood-API-Version': '1.431.4'
  };
  if (challenge_id) headers['X-Robinhood-Challenge-ID'] = challenge_id;

  try {
    const resp = await fetch('https://api.robinhood.com/oauth2/token/', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const data = await resp.json();

    if (data.access_token) {
      rhToken = data.access_token;
      rhRefreshToken = data.refresh_token || '';
      console.log('[Robinhood] Login successful');
      return res.json({ ok: true, message: 'Logged in to Robinhood', expires_in: data.expires_in });
    }
    if (data.mfa_required || data.mfa_type) {
      return res.json({ mfa_required: true, mfa_type: data.mfa_type || 'sms', message: 'MFA code required' });
    }
    if (data.challenge) {
      return res.json({ challenge: true, challenge_id: data.challenge.id, challenge_type: data.challenge.type, message: 'Challenge verification required' });
    }
    return res.status(401).json({ error: true, message: data.detail || 'Login failed', data });
  } catch (e) {
    res.status(502).json({ error: true, message: 'Login error: ' + e.message });
  }
});

// POST /proxy/robinhood/logout — Clear Robinhood session
app.post('/proxy/robinhood/logout', (req, res) => {
  rhToken = '';
  rhRefreshToken = '';
  console.log('[Robinhood] Logged out');
  res.json({ ok: true, message: 'Logged out' });
});

// GET /proxy/robinhood/status — Check Robinhood login status
app.get('/proxy/robinhood/status', (req, res) => {
  res.json({ logged_in: !!rhToken });
});

async function refreshRobinhoodToken() {
  if (!rhRefreshToken) return false;
  try {
    const resp = await fetch('https://api.robinhood.com/oauth2/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: rhRefreshToken,
        scope: 'internal',
        client_id: 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
        device_token: rhDeviceToken
      }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await resp.json();
    if (data.access_token) {
      rhToken = data.access_token;
      rhRefreshToken = data.refresh_token || rhRefreshToken;
      console.log('[Robinhood] Token refreshed');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[Robinhood] Refresh failed:', e.message);
    return false;
  }
}

app.listen(PORT, () => {
  console.log('CORS proxy running on http://localhost:' + PORT);
  console.log('  Yahoo:      http://localhost:' + PORT + '/proxy/yahoo?url=...');
  console.log('  News:       http://localhost:' + PORT + '/proxy/news?url=...');
  console.log('  AI Proxy:   http://localhost:' + PORT + '/proxy/ai/messages');
  console.log('  Robinhood:  http://localhost:' + PORT + '/proxy/robinhood?endpoint=...');
  console.log('  RH Auth:    http://localhost:' + PORT + '/proxy/robinhood/auth?endpoint=...');
  console.log('  RH Login:   http://localhost:' + PORT + '/proxy/robinhood/login (POST)');
  console.log('  RH Status:  http://localhost:' + PORT + '/proxy/robinhood/status');
  if (storedApiKey) console.log('  API key pre-loaded from ANTHROPIC_API_KEY env var');
});
