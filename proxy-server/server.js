// Load environment variables FIRST — before any other imports
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Credential availability (checked once at startup) ──
const hasRhToken = !!process.env.RH_AUTH_TOKEN;
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

if (!hasRhToken) console.warn('[STARTUP] RH_AUTH_TOKEN not set — /proxy/robinhood route disabled');
if (!hasAnthropicKey) console.warn('[STARTUP] ANTHROPIC_API_KEY not set — /proxy/anthropic route disabled');

// ── CORS — allow only the configured frontend origin ──
const allowedOrigin = process.env.ALLOWED_ORIGIN || '';

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Always allow preflight
  if (req.method === 'OPTIONS') {
    if (allowedOrigin && origin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    return res.sendStatus(204);
  }

  // Reject requests from disallowed origins
  if (allowedOrigin) {
    if (origin && origin !== allowedOrigin) {
      return res.status(403).json({ error: true, message: 'Origin not allowed' });
    }
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  } else {
    // No ALLOWED_ORIGIN set — allow all (local dev only)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Body parsing ──
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting — global ──
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many requests — try again in a minute' }
});
app.use(globalLimiter);

// ── Rate limiting — stricter for Anthropic (expensive calls) ──
const anthropicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Anthropic rate limit — max 20 requests per minute' }
});

// ── Health check ──
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    services: {
      robinhood: hasRhToken,
      anthropic: hasAnthropicKey
    }
  });
});

// ── Robinhood Proxy ──
app.post('/proxy/robinhood', async (req, res) => {
  if (!hasRhToken) {
    return res.status(503).json({ error: true, message: 'Robinhood token not configured on server' });
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
        'Authorization': 'Bearer ' + process.env.RH_AUTH_TOKEN,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000
    };

    if (upperMethod === 'POST' && payload) {
      fetchOpts.body = JSON.stringify(payload);
    }

    const rhResp = await fetch(rhUrl, fetchOpts);

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
app.post('/proxy/anthropic', anthropicLimiter, async (req, res) => {
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

// ── Start server ──
app.listen(PORT, () => {
  console.log(`[Proxy] Server running on port ${PORT}`);
  console.log(`[Proxy] Robinhood: ${hasRhToken ? 'enabled' : 'DISABLED (no token)'}`);
  console.log(`[Proxy] Anthropic: ${hasAnthropicKey ? 'enabled' : 'DISABLED (no key)'}`);
  if (allowedOrigin) {
    console.log(`[Proxy] CORS origin: ${allowedOrigin}`);
  } else {
    console.log('[Proxy] CORS: allowing all origins (set ALLOWED_ORIGIN for production)');
  }
});
