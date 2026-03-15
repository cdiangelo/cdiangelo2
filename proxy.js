// ADDED — Phase 1: Local CORS proxy server
// Replaces dependency on api.allorigins.win
// Start: node proxy.js — listens on port 3001

const express = require('express');
const app = express();
const PORT = 3001;

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

// CORS middleware — allow all origins (local dev only)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

app.listen(PORT, () => {
  console.log('CORS proxy running on http://localhost:' + PORT);
  console.log('  Yahoo: http://localhost:' + PORT + '/proxy/yahoo?url=...');
  console.log('  News:  http://localhost:' + PORT + '/proxy/news?url=...');
});
