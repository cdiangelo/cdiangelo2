// ADDED — Phase 1: Local CORS proxy server
// Replaces dependency on api.allorigins.win
// Start: node proxy.js — listens on port 3001

const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
app.set('trust proxy', true); // Trust Render/reverse proxy for accurate client IP
const PORT = process.env.PORT || 3001;
const BUILD_VERSION = Date.now().toString(36); // unique per server start — used for cache busting

// ── AI API key: held server-side only, never sent to browser ──
const ADMIN_PASSWORD = 'animalcrackers'; // Must match workspace.html
let storedApiKey = process.env.ANTHROPIC_API_KEY || '';
// Fallback: read from file if env var not set (survives process restarts)
if (!storedApiKey) {
  try { storedApiKey = fs.readFileSync('.ai_key', 'utf8').trim(); } catch(_) {}
}
if (!storedApiKey) {
  console.log('[AI Proxy] No API key found. Set ANTHROPIC_API_KEY env var (recommended for Render) or save via admin panel.');
}

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

// GET /proxy/article?url=<encoded_url> — Fetch article HTML server-side (bypasses CAPTCHA/paywalls)
// Returns cleaned article content as HTML fragment for inline viewing
app.get('/proxy/article', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: true, message: 'Missing url parameter' });

  const cached = getCached('article:' + url);
  if (cached) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(cached.data);
  }

  try {
    // Try archive.is first (best for paywalled content)
    let html = '';
    let fetched = false;
    try {
      const archiveResp = await fetch('https://archive.is/newest/' + url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000)
      });
      if (archiveResp.ok) {
        const archiveHtml = await archiveResp.text();
        // archive.is returns full page — check if it's actual content (not a CAPTCHA page)
        if (archiveHtml.length > 5000 && !archiveHtml.includes('g-recaptcha') && !archiveHtml.includes('h-captcha')) {
          html = archiveHtml;
          fetched = true;
        }
      }
    } catch (_) { /* archive.is failed, try direct */ }

    // Fallback: fetch article directly
    if (!fetched) {
      const directResp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000)
      });
      if (!directResp.ok) {
        return res.status(directResp.status).json({ error: true, message: 'Article fetch failed (HTTP ' + directResp.status + ')' });
      }
      html = await directResp.text();
    }

    // Extract readable content: find <article>, or main content block, or body
    let content = '';

    // Try to extract <article> tag content
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      content = articleMatch[1];
    } else {
      // Try common content selectors by class/id
      const contentMatch = html.match(/<(?:div|section|main)[^>]*(?:class|id)="[^"]*(?:article|story|content|post|entry|main)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section|main)>/i);
      if (contentMatch) {
        content = contentMatch[1];
      } else {
        // Last resort: extract body
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        content = bodyMatch ? bodyMatch[1] : html;
      }
    }

    // Strip scripts, styles, and nav elements
    content = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '');

    // Wrap in a clean readable page
    const readable = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 720px; margin: 20px auto; padding: 0 20px;
         line-height: 1.7; color: #1a1a1a; background: #fff; font-size: 17px; }
  img { max-width: 100%; height: auto; border-radius: 4px; margin: 12px 0; }
  a { color: #1a73e8; }
  h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.3; }
  blockquote { border-left: 3px solid #ddd; padding-left: 16px; margin-left: 0; color: #555; }
  figure { margin: 16px 0; }
  figcaption { font-size: 14px; color: #666; margin-top: 4px; }
  .proxy-notice { background: #f0f4ff; border: 1px solid #c8d6f0; border-radius: 6px; padding: 8px 14px;
                  font-size: 13px; color: #555; margin-bottom: 20px; font-family: sans-serif; }
  .proxy-notice a { color: #1a73e8; }
</style></head><body>
<div class="proxy-notice">Fetched via proxy &mdash; <a href="${url}" target="_blank">Open original article &#8599;</a></div>
${content}
</body></html>`;

    setCache('article:' + url, readable, 'text/html');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(readable);
  } catch (e) {
    res.status(502).json({ error: true, message: 'Article proxy error: ' + e.message });
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
  // Persist to file so key survives process restarts
  try { fs.writeFileSync('.ai_key', apiKey); } catch(_) {}
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

    // If streaming, forward the SSE stream to the client
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = anthropicResp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch (err) {
        console.error('[AI Proxy] Stream error:', err.message);
      } finally {
        res.end();
      }
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
const RH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Standard browser headers for all Robinhood requests
const RH_BROWSER_HEADERS = {
  'User-Agent': RH_USER_AGENT,
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

// Stored Robinhood credentials (admin only) — set via env vars or POST /proxy/robinhood/set-credentials
let rhStoredUsername = process.env.RH_USERNAME || '';
let rhStoredPassword = process.env.RH_PASSWORD || '';

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
      headers: { ...RH_BROWSER_HEADERS },
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
    const rhHeaders = {
        ...RH_BROWSER_HEADERS,
        'Authorization': 'Bearer ' + rhToken
      };
    const resp = await fetch(url, {
      headers: rhHeaders,
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      if (resp.status === 401) {
        // Try token refresh
        const refreshed = await refreshRobinhoodToken();
        if (refreshed) {
          const retryResp = await fetch(url, {
            headers: { ...rhHeaders, 'Authorization': 'Bearer ' + rhToken },
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
    password,
    try_passkeys: false,
    token_request_path: '/login',
    create_read_only_secondary_token: true
  };
  if (mfa_code) body.mfa_code = mfa_code;

  const headers = {
    ...RH_BROWSER_HEADERS,
    'Content-Type': 'application/json',
    'X-Robinhood-API-Version': '1.431.4',
    'Referer': 'https://robinhood.com/login/'
  };
  if (challenge_id) headers['X-Robinhood-Challenge-ID'] = challenge_id;

  try {
    const resp = await fetch('https://api.robinhood.com/oauth2/token/', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });

    const contentType = resp.headers.get('content-type') || '';
    const rawText = await resp.text();

    if (!resp.ok) {
      console.error(`[Robinhood] Login HTTP ${resp.status}, content-type: ${contentType}, body: ${rawText.substring(0, 500)}`);
      let detail = 'Robinhood returned HTTP ' + resp.status;
      try {
        const errData = JSON.parse(rawText);
        detail = errData.detail || errData.message || detail;
      } catch (_) { /* non-JSON response */ }
      return res.status(resp.status >= 400 && resp.status < 600 ? resp.status : 502)
        .json({ error: true, message: detail });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      console.error(`[Robinhood] Login OK but non-JSON, content-type: ${contentType}, body: ${rawText.substring(0, 500)}`);
      return res.status(502).json({ error: true, message: 'Robinhood returned non-JSON response' });
    }

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
  res.json({ logged_in: !!rhToken, has_stored_credentials: !!(rhStoredUsername && rhStoredPassword) });
});

// POST /proxy/robinhood/set-token — Paste a browser token directly (admin only)
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
      // Save the token anyway — verification endpoint may be blocked by bot detection
      // The token will be validated on first real API use instead
      rhToken = token;
      rhRefreshToken = '';
      console.log('[Robinhood] Token saved despite verify failure — will validate on first use');
      return res.json({ ok: true, warning: true, message: 'Token saved but could not verify (HTTP ' + check.status + '). It will be tested on first API call.' });
    }
    rhToken = token;
    rhRefreshToken = ''; // browser tokens don't have a refresh token
    console.log('[Robinhood] Token set via paste — verified OK');
    return res.json({ ok: true, message: 'Token verified and saved. You are logged in.' });
  } catch (e) {
    // Network error during verify — still save the token
    rhToken = token;
    rhRefreshToken = '';
    console.warn('[Robinhood] Token verify network error, saving anyway:', e.message);
    return res.json({ ok: true, warning: true, message: 'Token saved but verify failed (' + e.message + '). It will be tested on first API call.' });
  }
});

// POST /proxy/robinhood/set-credentials — Store credentials server-side (admin only)
app.post('/proxy/robinhood/set-credentials', (req, res) => {
  const { password, rh_username, rh_password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: true, message: 'Admin password required' });
  if (!rh_username || !rh_password) return res.status(400).json({ error: true, message: 'rh_username and rh_password required' });
  rhStoredUsername = rh_username;
  rhStoredPassword = rh_password;
  console.log('[Robinhood] Credentials stored for:', rh_username);
  res.json({ ok: true, message: 'Credentials stored for ' + rh_username });
});

// POST /proxy/robinhood/quick-login — Login using stored credentials (admin only)
app.post('/proxy/robinhood/quick-login', async (req, res) => {
  const { password, mfa_code, challenge_id } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: true, message: 'Admin password required' });
  if (!rhStoredUsername || !rhStoredPassword) return res.status(400).json({ error: true, message: 'No stored credentials. Set RH_USERNAME/RH_PASSWORD env vars or use /proxy/robinhood/set-credentials first.' });

  if (!rhDeviceToken) {
    const crypto = require('crypto');
    rhDeviceToken = crypto.randomUUID();
  }

  const body = {
    grant_type: 'password',
    scope: 'internal',
    client_id: 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
    device_token: rhDeviceToken,
    username: rhStoredUsername,
    password: rhStoredPassword,
    try_passkeys: false,
    token_request_path: '/login',
    create_read_only_secondary_token: true
  };
  if (mfa_code) body.mfa_code = mfa_code;

  const headers = {
    ...RH_BROWSER_HEADERS,
    'Content-Type': 'application/json',
    'X-Robinhood-API-Version': '1.431.4',
    'Referer': 'https://robinhood.com/login/'
  };
  if (challenge_id) headers['X-Robinhood-Challenge-ID'] = challenge_id;

  try {
    const resp = await fetch('https://api.robinhood.com/oauth2/token/', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });

    const rawText = await resp.text();
    if (!resp.ok) {
      console.error(`[Robinhood] Quick-login HTTP ${resp.status}, body: ${rawText.substring(0, 500)}`);
      let detail = 'Robinhood returned HTTP ' + resp.status;
      try { const errData = JSON.parse(rawText); detail = errData.detail || errData.message || detail; } catch (_) {}
      return res.status(resp.status >= 400 && resp.status < 600 ? resp.status : 502).json({ error: true, message: detail });
    }

    let data;
    try { data = JSON.parse(rawText); } catch (_) {
      return res.status(502).json({ error: true, message: 'Robinhood returned non-JSON response' });
    }

    if (data.access_token) {
      rhToken = data.access_token;
      rhRefreshToken = data.refresh_token || '';
      console.log('[Robinhood] Quick-login successful');
      return res.json({ ok: true, message: 'Logged in via stored credentials', expires_in: data.expires_in });
    }
    if (data.mfa_required || data.mfa_type) {
      return res.json({ mfa_required: true, mfa_type: data.mfa_type || 'sms', message: 'MFA code required' });
    }
    if (data.challenge) {
      return res.json({ challenge: true, challenge_id: data.challenge.id, challenge_type: data.challenge.type, message: 'Challenge verification required' });
    }
    return res.status(401).json({ error: true, message: data.detail || 'Login failed', data });
  } catch (e) {
    res.status(502).json({ error: true, message: 'Quick-login error: ' + e.message });
  }
});

async function refreshRobinhoodToken() {
  if (!rhRefreshToken) return false;
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
        client_id: 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
        device_token: rhDeviceToken
      }),
      signal: AbortSignal.timeout(10000)
    });
    const rawText = await resp.text();
    if (!resp.ok) {
      console.error(`[Robinhood] Refresh HTTP ${resp.status}, body: ${rawText.substring(0, 300)}`);
      return false;
    }
    let data;
    try { data = JSON.parse(rawText); } catch (_) {
      console.error('[Robinhood] Refresh returned non-JSON');
      return false;
    }
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

// ═══════════════════════════════════════════
// ADMIN TRACKING — server-side usage, device/IP tracking & access requests
// ═══════════════════════════════════════════

const userUsage = new Map();      // userName -> {prompts, tokens, lastActive, devices, ips}
const deviceRegistry = new Map(); // deviceId -> {userName, ips[], firstSeen, lastSeen}
const accessRequests = [];        // [{name, contact, message, ts}]

// Helper: extract client IP from request (works behind proxies like Render)
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || req.ip
    || 'unknown';
}

// POST /proxy/admin/register-device — Client registers device + name on login
app.post('/proxy/admin/register-device', (req, res) => {
  const { userName, deviceId } = req.body || {};
  if (!userName) return res.status(400).json({ error: true, message: 'Missing userName' });
  const ip = getClientIp(req);
  const now = new Date().toISOString();

  // Track device → user mapping
  if (deviceId) {
    const devEntry = deviceRegistry.get(deviceId) || { userName, ips: [], firstSeen: now, lastSeen: now, allNames: [] };
    devEntry.lastSeen = now;
    devEntry.userName = userName;
    if (!devEntry.allNames.includes(userName)) devEntry.allNames.push(userName);
    if (!devEntry.ips.includes(ip)) devEntry.ips.push(ip);
    deviceRegistry.set(deviceId, devEntry);
  }

  // Initialize or update user usage entry with device/IP info
  const existing = userUsage.get(userName) || { prompts: 0, tokens: 0, lastActive: null, devices: [], ips: [] };
  existing.lastActive = now;
  if (deviceId && !existing.devices.includes(deviceId)) existing.devices.push(deviceId);
  if (!existing.ips.includes(ip)) existing.ips.push(ip);
  userUsage.set(userName, existing);

  res.json({ ok: true });
});

// POST /proxy/admin/log-usage — Client reports usage after each AI call
app.post('/proxy/admin/log-usage', (req, res) => {
  const { userName, tokensUsed, deviceId } = req.body || {};
  if (!userName) return res.status(400).json({ error: true, message: 'Missing userName' });
  const ip = getClientIp(req);
  const existing = userUsage.get(userName) || { prompts: 0, tokens: 0, lastActive: null, devices: [], ips: [] };
  existing.prompts++;
  existing.tokens += (tokensUsed || 0);
  existing.lastActive = new Date().toISOString();
  // Track device and IP per user
  if (deviceId && !existing.devices.includes(deviceId)) existing.devices.push(deviceId);
  if (!existing.ips.includes(ip)) existing.ips.push(ip);
  userUsage.set(userName, existing);

  // Update device registry too
  if (deviceId) {
    const devEntry = deviceRegistry.get(deviceId) || { userName, ips: [], firstSeen: existing.lastActive, lastSeen: existing.lastActive, allNames: [] };
    devEntry.lastSeen = existing.lastActive;
    if (!devEntry.allNames.includes(userName)) devEntry.allNames.push(userName);
    if (!devEntry.ips.includes(ip)) devEntry.ips.push(ip);
    deviceRegistry.set(deviceId, devEntry);
  }

  res.json({ ok: true });
});

// GET /proxy/admin/users — Returns all user usage (admin-protected)
app.get('/proxy/admin/users', (req, res) => {
  const pw = req.query.password;
  if (pw !== ADMIN_PASSWORD) return res.status(403).json({ error: true, message: 'Invalid admin password' });
  const users = {};
  userUsage.forEach((data, name) => { users[name] = data; });
  // Attach cross-reference: flag users who share a device or IP with other names
  for (const [name, data] of Object.entries(users)) {
    const aliases = new Set();
    (data.devices || []).forEach(devId => {
      const dev = deviceRegistry.get(devId);
      if (dev) dev.allNames.forEach(n => { if (n !== name) aliases.add(n); });
    });
    (data.ips || []).forEach(ip => {
      userUsage.forEach((otherData, otherName) => {
        if (otherName !== name && (otherData.ips || []).includes(ip)) aliases.add(otherName);
      });
    });
    if (aliases.size > 0) data.possibleAliases = [...aliases];
  }
  res.json(users);
});

// GET /proxy/admin/devices — Returns device registry (admin-protected)
app.get('/proxy/admin/devices', (req, res) => {
  const pw = req.query.password;
  if (pw !== ADMIN_PASSWORD) return res.status(403).json({ error: true, message: 'Invalid admin password' });
  const devices = {};
  deviceRegistry.forEach((data, devId) => { devices[devId] = data; });
  res.json(devices);
});

// POST /proxy/admin/request-access — User submits access request
app.post('/proxy/admin/request-access', (req, res) => {
  const { name, contact, deviceId, message } = req.body || {};
  if (!name) return res.status(400).json({ error: true, message: 'Missing name' });
  const ip = getClientIp(req);
  accessRequests.push({ name, contact: contact || '', deviceId: deviceId || '', ip, message: message || '', ts: new Date().toISOString() });
  res.json({ ok: true });
});

// GET /proxy/admin/requests — Returns access requests (admin-protected)
app.get('/proxy/admin/requests', (req, res) => {
  const pw = req.query.password;
  if (pw !== ADMIN_PASSWORD) return res.status(403).json({ error: true, message: 'Invalid admin password' });
  res.json(accessRequests);
});

// ── Build version endpoint — clients poll to detect new deploys ──
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ version: BUILD_VERSION });
});

// Serve static files with smart caching:
// - HTML files: no-cache (always revalidate so users get latest markup)
// - JS/CSS files: short cache + version query param for busting
// - Inject ?v=BUILD_VERSION into local script/link tags in HTML
app.use((req, res, next) => {
  // Only intercept .html requests and root
  const urlPath = req.path;
  if (urlPath !== '/' && !urlPath.endsWith('.html')) {
    // JS/CSS: cache for 1 minute so repeat loads within a session are fast,
    // but stale copies expire quickly after a deploy
    if (urlPath.endsWith('.js') || urlPath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('ETag', BUILD_VERSION);
    }
    return next();
  }
  // Resolve the HTML file
  const filePath = path.join(__dirname, urlPath === '/' ? 'workspace.html' : urlPath);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next(); // fall through to static handler
    // Inject version query param on local script/link tags
    const versioned = html
      .replace(/(src|href)="\.\/([^"]+\.(js|css))"/g, `$1="./$2?v=${BUILD_VERSION}"`)
      .replace('</head>', `<script>window.__BUILD_VERSION="${BUILD_VERSION}";</script>\n</head>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(versioned);
  });
});
app.use(express.static(path.join(__dirname)));

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
