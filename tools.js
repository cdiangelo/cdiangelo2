// ADDED — Phase 5: Extracted tool definitions and handlers
// This ES module contains all Claude tool schemas and handler functions.
// It self-registers on window so the inline dispatcher in workspace.html can delegate.
//
// GLOBAL DEP: ssD, ssR, ssC, parseRef, colN, evalF, ssAddPage, ssPages, ssActivePageId, saveSsPages, renderSsTabs, ssSaveCurrentPage, ssRender (spreadsheet)
// GLOBAL DEP: np, npPages, npActivePageId, npAddPage, npPageIdCounter, saveNpPages, renderNpTabs, npSaveCurrentPage (notepad)
// GLOBAL DEP: gcExpressions, renderGCExprList, renderGC (graph)
// GLOBAL DEP: stockTickers, compareTickers, newsTickerWatchlist, renderStockDash, renderStockChips, renderCompareChart, renderNewsChips, renderNewsFeed (stocks/news)
// GLOBAL DEP: cmNodes, cmEdges, cmNID, cmSave, cmRender (concept map)
// GLOBAL DEP: wbC, wbX, wbLayers, wbAddLayer, wbRenderLayers, wbRenderLayerList, wbSaveState, wbLayerIdCounter (whiteboard)
// GLOBAL DEP: COMPANY_DB, getCompanyMetrics, getCompanyMetricsReal, getCompanyMetricsSimulated, genStockData, fetchRealStockData, genNews, formatCap (data)
// GLOBAL DEP: rhLoggedIn, fetchRobinhoodQuote, fetchRobinhoodFundamentals, searchRobinhoodInstruments, fetchRobinhoodPositions, fetchRobinhoodAccount, fetchRobinhoodOrders, fetchRobinhoodNews (robinhood)
// GLOBAL DEP: toast, addAiMsg, LS, $, MODEL_RATES, PRICING_TOKEN_PROFILES (utilities)
// GLOBAL DEP: window.appendAgentMemory, window.getAgentMemory (agent memory)

export const toolDefinitions = [
  // READ TOOLS
  { name: 'get_sheet_range', description: 'Read current cell values from the spreadsheet. Returns cell refs and their values.', input_schema: { type: 'object', properties: { range: { type: 'string', description: 'Cell range like "A1:C10" or "A1:Z50" for full sheet' } }, required: ['range'] } },
  { name: 'get_note', description: 'Read notepad content. Returns HTML-formatted content. Can target a specific page by title or id. Returns list of all pages.', input_schema: { type: 'object', properties: { page_title: { type: 'string', description: 'Read a specific page by its title' }, page_id: { type: 'string', description: 'Read a specific page by its ID' } } } },
  { name: 'get_graph_state', description: 'Get currently active graph expressions and their colors.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_watchlist', description: 'Get tracked stocks, comparison chart tickers, and news watchlist.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_stock_data', description: 'Get OHLCV price data for a stock ticker over a time range.', input_schema: { type: 'object', properties: { ticker: { type: 'string', description: 'Stock ticker symbol (e.g. AAPL)' }, range: { type: 'string', enum: ['1D', '5D', '1M', '6M', '1Y', '3Y', '5Y'], description: 'Time range' } }, required: ['ticker'] } },
  { name: 'get_stock_fundamentals', description: 'Get fundamental metrics for a stock: price, market cap, PE, growth, sector.', input_schema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } },
  { name: 'get_news', description: 'Get news articles for a keyword/ticker. Returns titles, snippets, sources, sentiment.', input_schema: { type: 'object', properties: { keyword: { type: 'string' }, limit: { type: 'number', description: 'Max articles to return (default 5)' } }, required: ['keyword'] } },
  { name: 'get_concept_map', description: 'Get concept map nodes and edges.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_portfolio', description: 'Get Robinhood portfolio positions, account balance, and buying power. Requires Robinhood login.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_orders', description: 'Get recent Robinhood order history. Requires Robinhood login.', input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max orders to return (default 20)' } } } },
  { name: 'search_ticker', description: 'Search for stock tickers and company names via Robinhood instrument search. Returns matching symbols, names, and types.', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search query (company name or ticker)' } }, required: ['query'] } },

  // WRITE TOOLS
  { name: 'write_cells', description: 'Write values or formulas to specific spreadsheet cells. Auto-creates a new sheet tab for your output.', input_schema: { type: 'object', properties: { cells: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string', description: 'Cell reference (e.g. A1, B2)' }, value: { type: 'string', description: 'Value or formula (e.g. "Hello", "42", "=SUM(A1:A5)")' } }, required: ['ref', 'value'] } }, label: { type: 'string', description: 'Label for the new sheet tab (e.g. "Stock Analysis")' }, use_current_tab: { type: 'boolean', description: 'Set true to write to the current tab instead of creating a new one' } }, required: ['cells'] } },
  { name: 'clear_range', description: 'Clear all cells in a range.', input_schema: { type: 'object', properties: { range: { type: 'string', description: 'Range to clear (e.g. A1:C10)' } }, required: ['range'] } },
  { name: 'create_table', description: 'Create a formatted table in the sheet starting at anchor cell with headers and rows. Auto-creates a new sheet tab.', input_schema: { type: 'object', properties: { anchor: { type: 'string', description: 'Top-left cell (e.g. A1)' }, headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, title: { type: 'string', description: 'Title for the new sheet tab' }, use_current_tab: { type: 'boolean', description: 'Set true to write to current tab instead of creating new one' } }, required: ['anchor', 'headers', 'rows'] } },
  { name: 'write_note', description: 'Write content to the notepad. Auto-creates a new tab for your output. Use target_page to write to a specific existing page by title, or append=true to add to current tab.', input_schema: { type: 'object', properties: { content: { type: 'string', description: 'Text content to write (supports HTML)' }, append: { type: 'boolean', description: 'If true, append to current tab instead of creating a new one' }, label: { type: 'string', description: 'Label for the new notepad tab (e.g. "Pricing Strategy")' }, use_current_tab: { type: 'boolean', description: 'Set true to write to current tab without creating a new one' }, target_page: { type: 'string', description: 'Write to a specific notepad page by title. Creates the page if it does not exist. Use with append=true to add to that page.' } }, required: ['content'] } },
  { name: 'update_graph', description: 'Set graph calculator expressions. Replaces all current expressions.', input_schema: { type: 'object', properties: { expressions: { type: 'array', items: { type: 'string' }, description: 'Math expressions like "sin(x)", "x^2", "2*cos(x)+1"' } }, required: ['expressions'] } },
  { name: 'add_stock', description: 'Add a stock ticker to the watchlist/dashboard.', input_schema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } },
  { name: 'remove_stock', description: 'Remove a stock ticker from the watchlist.', input_schema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } },
  { name: 'set_comparison', description: 'Set the comparison chart to show specific tickers.', input_schema: { type: 'object', properties: { tickers: { type: 'array', items: { type: 'string' } } }, required: ['tickers'] } },
  { name: 'add_news_ticker', description: 'Add a ticker to the news watchlist feed.', input_schema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } },
  { name: 'add_concept_node', description: 'Add a node to the concept map.', input_schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } }, required: ['title'] } },
  { name: 'write_to_draw_pane', description: 'Add an image to the whiteboard/draw pane as a layer.', input_schema: { type: 'object', properties: { image_url: { type: 'string', description: 'URL of the image' }, label: { type: 'string' } }, required: ['image_url'] } },
  { name: 'add_text_overlay', description: 'Draw text on the whiteboard canvas.', input_schema: { type: 'object', properties: { text: { type: 'string' }, position: { type: 'string', enum: ['top', 'center', 'bottom'], description: 'Vertical position' }, size: { type: 'number', description: 'Font size in pixels (default 24)' } }, required: ['text'] } },
  { name: 'clear_draw_pane', description: 'Clear the whiteboard canvas and all layers.', input_schema: { type: 'object', properties: {} } },
  { name: 'show_toast', description: 'Show a brief notification toast to the user.', input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },

  // ANALYSIS TOOLS
  { name: 'run_scenario', description: 'Run bull/base/bear scenario projections for a stock. Returns projected price arrays for graphing or tables.', input_schema: { type: 'object', properties: { ticker: { type: 'string' }, scenarios: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, growth_rate: { type: 'number', description: 'Annual growth rate as decimal (e.g. 0.15 for 15%)' } }, required: ['name', 'growth_rate'] } } }, required: ['ticker', 'scenarios'] } },
  { name: 'build_thesis', description: 'Synthesize price data, fundamentals, and news into a written investment thesis for a ticker.', input_schema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } },
  { name: 'sentiment_summary', description: 'Analyze recent news articles for a keyword and produce a scored sentiment summary.', input_schema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] } },
  { name: 'create_template', description: 'Scaffold a standard layout template into the sheet.', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['stock_comparison_table', 'earnings_tracker', 'portfolio_summary', 'scenario_model', 'news_sentiment_board', 'macro_dashboard'] }, anchor_cell: { type: 'string', description: 'Top-left cell to start template (default A1)' } }, required: ['type'] } },

  // IMAGE/MEME TOOLS
  { name: 'search_image', description: 'Search for images by query. Returns URLs that can be added to draw pane.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'create_meme', description: 'Generate a finished meme image via imgflip API with text baked in. Returns the image URL and adds it to the draw pane. Keep text SHORT (under 8 words per line).', input_schema: { type: 'object', properties: { template_name: { type: 'string', description: 'Meme template: drake, stonks, this_is_fine, galaxy_brain, disaster_girl, expanding_brain, trade_offer, change_my_mind, always_has_been, distracted_boyfriend, gru_plan, hide_the_pain' }, top_text: { type: 'string', description: 'Top text (setup). Keep under 8 words.' }, bottom_text: { type: 'string', description: 'Bottom text (punchline). Keep under 8 words.' } }, required: ['template_name', 'top_text', 'bottom_text'] } },

  // RESEARCH TOOLS
  { name: 'deep_research', description: 'Trigger a deep research scan on a topic. Fetches real articles from Google News, then you can analyze them. Returns article list for your synthesis.', input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'Research topic or query' } }, required: ['topic'] } },

  // PRICING/BUSINESS TOOLS
  { name: 'pricing_analysis', description: 'Run pricing scenario analysis. Models API costs at different user scales, evaluates unit economics and profitability dynamics. Returns cost scenarios for analysis. Write results to sheet and notepad.', input_schema: { type: 'object', properties: { product_type: { type: 'string', description: 'Type of product (SaaS tool, API wrapper, consumer app, etc.)' }, target_users: { type: 'number', description: 'Target user count' }, queries_per_user: { type: 'number', description: 'Expected queries per user per month' }, competitors: { type: 'string', description: 'Comma-separated competitor names to research' } }, required: ['product_type'] } },

  // WHITEBOARD TOOLS (Phase 6)
  { name: 'get_draw_pane_state', description: 'Read the current whiteboard/draw pane state: layers, canvas size, whether empty.', input_schema: { type: 'object', properties: {} } },
  { name: 'draw_shape', description: 'Draw a primitive shape (rect, circle, line, arrow) on the whiteboard canvas.', input_schema: { type: 'object', properties: { shape: { type: 'string', enum: ['rect', 'circle', 'line', 'arrow'], description: 'Shape type' }, x: { type: 'number', description: 'X position (pixels from left)' }, y: { type: 'number', description: 'Y position (pixels from top)' }, width: { type: 'number', description: 'Width (for rect/circle)' }, height: { type: 'number', description: 'Height (for rect/circle)' }, x2: { type: 'number', description: 'End X (for line/arrow)' }, y2: { type: 'number', description: 'End Y (for line/arrow)' }, color: { type: 'string', description: 'Stroke color (hex or CSS name)' }, strokeWidth: { type: 'number', description: 'Stroke width 1-10' }, fill: { type: 'string', description: 'Fill color or null for transparent' }, label: { type: 'string', description: 'Optional text label centered in shape' }, layerName: { type: 'string', description: 'Name shown in Layers panel' } }, required: ['shape', 'x', 'y'] } },
  { name: 'draw_chart_on_whiteboard', description: 'Render a labeled chart (bar, line, pie, donut) directly onto the whiteboard canvas using Chart.js.', input_schema: { type: 'object', properties: { chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'donut'], description: 'Chart type' }, title: { type: 'string' }, labels: { type: 'array', items: { type: 'string' }, description: 'X-axis labels or slice names' }, datasets: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, values: { type: 'array', items: { type: 'number' } }, color: { type: 'string' } }, required: ['label', 'values', 'color'] } }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, showLegend: { type: 'boolean' }, showValues: { type: 'boolean' }, layerName: { type: 'string' } }, required: ['chartType', 'title', 'labels', 'datasets', 'x', 'y', 'width', 'height'] } },
  { name: 'annotate_whiteboard', description: 'Add a callout annotation with an arrow pointing to a specific canvas coordinate.', input_schema: { type: 'object', properties: { text: { type: 'string', description: 'Annotation content' }, targetX: { type: 'number', description: 'Arrow tip X' }, targetY: { type: 'number', description: 'Arrow tip Y' }, labelX: { type: 'number', description: 'Text box X' }, labelY: { type: 'number', description: 'Text box Y' }, arrowColor: { type: 'string' }, boxColor: { type: 'string', description: 'Text box background' }, textColor: { type: 'string' }, fontSize: { type: 'number', description: '12-24' }, layerName: { type: 'string' } }, required: ['text', 'targetX', 'targetY', 'labelX', 'labelY'] } },
  { name: 'draw_summary_card', description: 'Render a formatted summary card (title + bullet items) as a styled rectangle on the whiteboard.', input_schema: { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' }, description: 'Bullet lines or Key: Value pairs' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, style: { type: 'string', enum: ['dark', 'light', 'accent'] }, accentColor: { type: 'string', description: 'Header bar color' }, layerName: { type: 'string' } }, required: ['title', 'items', 'x', 'y', 'width'] } },

  // WHITEBOARD ENHANCEMENT TOOLS
  { name: 'draw_table', description: 'Render a formatted data table on the whiteboard with headers, rows, and optional styling.', input_schema: { type: 'object', properties: { headers: { type: 'array', items: { type: 'string' }, description: 'Column headers' }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Row data (array of arrays)' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, style: { type: 'string', enum: ['dark', 'light', 'accent'], description: 'Color scheme' }, headerColor: { type: 'string', description: 'Header bar color (default #3b82f6)' }, layerName: { type: 'string' } }, required: ['headers', 'rows', 'x', 'y'] } },
  { name: 'align_layers', description: 'Align or distribute whiteboard layers. Use after building multi-element visuals for clean professional layouts.', input_schema: { type: 'object', properties: { layerIds: { type: 'array', items: { type: 'number' }, description: 'Layer IDs to align. Omit for all layers.' }, alignment: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distribute-h', 'distribute-v'], description: 'Alignment type' } }, required: ['alignment'] } },
  { name: 'group_layers', description: 'Group whiteboard layers under a name so they move together.', input_schema: { type: 'object', properties: { layerIds: { type: 'array', items: { type: 'number' }, description: 'Layer IDs to group' }, groupName: { type: 'string', description: 'Group name shown in layers panel' } }, required: ['layerIds', 'groupName'] } },
  { name: 'ungroup_layers', description: 'Remove group assignment from layers.', input_schema: { type: 'object', properties: { groupName: { type: 'string', description: 'Group name to dissolve' } }, required: ['groupName'] } },
  { name: 'apply_whiteboard_template', description: 'Apply a layout template to the whiteboard. Returns region coordinates for placing content. Call this FIRST for executive/polished visuals.', input_schema: { type: 'object', properties: { template: { type: 'string', enum: ['dashboard', 'presentation', 'comparison', 'hierarchy', 'timeline'], description: 'Layout template' }, title: { type: 'string', description: 'Main title for the template' } }, required: ['template'] } },

  // CONCEPT MAP TOOLS (Phase 7)
  { name: 'add_concept_edge', description: 'Connect two existing concept map nodes with a labeled directed edge.', input_schema: { type: 'object', properties: { sourceLabel: { type: 'string', description: 'Exact label of source node' }, targetLabel: { type: 'string', description: 'Exact label of target node' }, edgeLabel: { type: 'string', description: 'Optional relationship label' }, edgeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: 'Line style' }, color: { type: 'string', description: 'Edge color' }, directed: { type: 'boolean', description: 'true = arrow, false = plain line' } }, required: ['sourceLabel', 'targetLabel'] } },
  { name: 'remove_concept_node', description: 'Remove a concept map node and optionally its connected edges.', input_schema: { type: 'object', properties: { label: { type: 'string', description: 'Exact label of node to remove' }, removeOrphanedEdges: { type: 'boolean', description: 'Also remove connected edges' } }, required: ['label'] } },
  { name: 'clear_concept_map', description: 'Wipe all nodes and edges from the concept map.', input_schema: { type: 'object', properties: { confirm: { type: 'boolean', description: 'Must be true to proceed (safety gate)' } }, required: ['confirm'] } },
  { name: 'set_concept_map_layout', description: 'Reposition all concept map nodes using a layout algorithm.', input_schema: { type: 'object', properties: { layout: { type: 'string', enum: ['radial', 'tree', 'force', 'grid', 'timeline'], description: 'Layout algorithm' } }, required: ['layout'] } }
];

// ── Tool handler implementations ──
// Each handler is an async function(input) that returns a JSON string.
// All references to globals (ssD, np, wbX, etc.) are resolved at call time from window scope.

export const toolHandlers = {
  // READ TOOLS
  get_sheet_range: async (input) => {
    const parts = input.range.split(':');
    const s = parseRef(parts[0]), e = parts[1] ? parseRef(parts[1]) : s;
    if (!s) return JSON.stringify({ error: 'Invalid range' });
    const endR = e ? e.row : s.row, endC = e ? e.col : s.col;
    const cells = [];
    for (let r = s.row; r <= Math.min(endR, ssR - 1); r++)
      for (let c = s.col; c <= Math.min(endC, ssC - 1); c++) {
        const raw = ssD[r][c] || '';
        const val = (typeof raw === 'string' && raw.startsWith('=')) ? evalF(raw) : raw;
        if (raw !== '') cells.push({ ref: colN(c) + (r + 1), raw, value: String(val) });
      }
    return JSON.stringify({ cells, total: cells.length });
  },

  get_note: async (input) => {
    // Support reading a specific page by title or ID
    if (input && input.page_title) {
      const page = npPages.find(p => p.title.toLowerCase() === input.page_title.toLowerCase());
      if (!page) return JSON.stringify({ error: 'Page not found: ' + input.page_title, available_pages: npPages.map(p => p.title) });
      return JSON.stringify({ content: page.body || '', page_title: page.title, format: 'html' });
    }
    if (input && input.page_id) {
      const page = npPages.find(p => p.id === input.page_id);
      if (!page) return JSON.stringify({ error: 'Page not found with id: ' + input.page_id, available_pages: npPages.map(p => ({ id: p.id, title: p.title })) });
      return JSON.stringify({ content: page.body || '', page_title: page.title, format: 'html' });
    }
    // Default: return current page with HTML preserved, plus list all pages
    const currentPage = npPages.find(p => p.id === npActivePageId);
    const allPages = npPages.map(p => ({ id: p.id, title: p.title }));
    return JSON.stringify({ content: np.innerHTML.trim(), page_title: currentPage ? currentPage.title : 'Unknown', format: 'html', pages: allPages });
  },

  get_graph_state: async () => JSON.stringify({ expressions: gcExpressions.map(e => ({ expr: e.expr, color: e.color })) }),

  get_watchlist: async () => JSON.stringify({ stocks: stockTickers, comparison: compareTickers, news: newsTickerWatchlist }),

  get_stock_data: async (input) => {
    const ticker = input.ticker.toUpperCase();
    const range = input.range || '1M';
    let closes = null;
    let isReal = false;
    try {
      const realData = await fetchRealStockData(ticker, range);
      if (realData && realData.length >= 2) { closes = realData; isReal = true; }
    } catch(e) {}
    // Only fall back to simulated data for known companies
    if (!closes) {
      const known = typeof COMPANY_DB !== 'undefined' && COMPANY_DB.find(c => c.ticker === ticker);
      if (!known) return JSON.stringify({ error: true, ticker, message: 'No data available for ' + ticker + '. Ticker not recognized and live data unavailable.' });
      closes = genStockData(ticker, range);
    }
    const stats = {
      current: closes[closes.length - 1].toFixed(2),
      high: Math.max(...closes).toFixed(2),
      low: Math.min(...closes).toFixed(2),
      change_pct: (((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2) + '%',
      data_points: closes.length,
      data_source: isReal ? 'Yahoo Finance (live)' : 'Simulated'
    };
    // Include enriched OHLCV data when available from cache
    const cacheKey = ticker + '_' + range;
    const cached = typeof stockDataCache !== 'undefined' && stockDataCache[cacheKey];
    if (isReal && cached && cached.volume) {
      const totalVol = cached.volume.reduce((a, b) => a + (b || 0), 0);
      const avgVol = totalVol / cached.volume.length;
      stats.total_volume = totalVol;
      stats.avg_volume = Math.round(avgVol);
      if (cached.high && cached.high.length) stats.period_high = Math.max(...cached.high.filter(v => v != null)).toFixed(2);
      if (cached.low && cached.low.length) stats.period_low = Math.min(...cached.low.filter(v => v != null && v > 0)).toFixed(2);
    }
    const recent = closes.slice(-20).map((v, i) => ({ price: +v.toFixed(2) }));
    return JSON.stringify({ ticker, range, stats, recent });
  },

  get_stock_fundamentals: async (input) => {
    const t = input.ticker.toUpperCase();
    const company = typeof COMPANY_DB !== 'undefined' && COMPANY_DB.find(c => c.ticker === t);
    const metrics = await getCompanyMetricsReal(t);
    // If we got only simulated data and ticker isn't in our DB, don't return fake metrics
    if (!company && metrics.source === 'simulated') {
      return JSON.stringify({ error: true, ticker: t, message: 'No data available for ' + t + '. Ticker not recognized and live data unavailable.' });
    }
    return JSON.stringify({ ticker: t, name: company ? company.name : t, sector: company ? company.sector : 'Unknown', ...metrics });
  },

  get_news: async (input) => {
    const articles = genNews(input.keyword).slice(0, input.limit || 5);
    return JSON.stringify(articles.map(a => ({ title: a.title, snippet: a.snippet, source: a.source, hours_ago: a.hoursAgo, tags: a.tags })));
  },

  get_concept_map: async () => JSON.stringify({ nodes: cmNodes.map(n => ({ id: n.id, title: n.title, desc: n.desc })), edges: cmEdges.map(e => ({ from: e.from, to: e.to, label: e.label || '' })) }),

  get_portfolio: async () => {
    if (!rhLoggedIn) return JSON.stringify({ error: true, message: 'Not logged in to Robinhood. Use the RH Login button in the stocks toolbar to connect your account.' });
    try {
      const [acct, positions] = await Promise.all([fetchRobinhoodAccount(), fetchRobinhoodPositions()]);
      return JSON.stringify({
        account: acct || { error: 'Could not fetch account' },
        positions: positions || [],
        logged_in: true,
        instruction: 'Present the portfolio data clearly. Build a portfolio summary table in the sheet using create_table with columns: Ticker, Shares, Avg Cost, Current Price, Market Value, Gain/Loss %, Weight. Write analysis insights to the notepad.'
      });
    } catch(e) {
      return JSON.stringify({ error: true, message: 'Failed to fetch portfolio: ' + e.message });
    }
  },

  get_orders: async (input) => {
    if (!rhLoggedIn) return JSON.stringify({ error: true, message: 'Not logged in to Robinhood. Use the RH Login button in the stocks toolbar to connect your account.' });
    try {
      const orders = await fetchRobinhoodOrders(input.limit || 20);
      return JSON.stringify({ orders: orders || [], logged_in: true });
    } catch(e) {
      return JSON.stringify({ error: true, message: 'Failed to fetch orders: ' + e.message });
    }
  },

  search_ticker: async (input) => {
    try {
      const results = await searchRobinhoodInstruments(input.query);
      const tickers = results.slice(0, 15).map(r => ({
        symbol: r.symbol,
        name: r.simple_name || r.name,
        type: r.type,
        tradeable: r.tradeable
      }));
      // Also check COMPANY_DB for local matches
      const localMatches = (typeof COMPANY_DB !== 'undefined' ? COMPANY_DB : [])
        .filter(c => c.ticker.toLowerCase().includes(input.query.toLowerCase()) || c.name.toLowerCase().includes(input.query.toLowerCase()))
        .slice(0, 5)
        .map(c => ({ symbol: c.ticker, name: c.name, type: 'stock', tradeable: true, source: 'local_db' }));
      // Merge, dedup by symbol
      const seen = new Set(tickers.map(t => t.symbol));
      localMatches.forEach(m => { if (!seen.has(m.symbol)) tickers.push(m); });
      return JSON.stringify({ query: input.query, results: tickers, source: results.length > 0 ? 'robinhood' : 'local_db' });
    } catch(e) {
      // Fallback to local DB only
      const localMatches = (typeof COMPANY_DB !== 'undefined' ? COMPANY_DB : [])
        .filter(c => c.ticker.toLowerCase().includes(input.query.toLowerCase()) || c.name.toLowerCase().includes(input.query.toLowerCase()))
        .slice(0, 15)
        .map(c => ({ symbol: c.ticker, name: c.name, type: 'stock', tradeable: true }));
      return JSON.stringify({ query: input.query, results: localMatches, source: 'local_db' });
    }
  },

  // WRITE TOOLS
  write_cells: async (input) => {
    if (!input.use_current_tab) {
      ssAddPage();
      const page = ssPages.find(p => p.id === ssActivePageId);
      if (page) page.title = 'Claude: ' + (input.label || 'Data');
      saveSsPages(); renderSsTabs();
    }
    let count = 0;
    (input.cells || []).forEach(c => {
      const ref = parseRef(c.ref);
      if (ref) {
        while (ref.row >= ssR) { ssD.push(new Array(ssC).fill('')); ssR++; }
        while (ref.col >= ssC) { ssD.forEach(r => r.push('')); ssC++; }
        ssD[ref.row][ref.col] = c.value;
        count++;
      }
    });
    LS('sheet', ssD); ssSaveCurrentPage(); ssRender();
    toast('Wrote ' + count + ' cells');
    return JSON.stringify({ success: true, count });
  },

  clear_range: async (input) => {
    const parts = input.range.split(':');
    const s = parseRef(parts[0]), e = parts[1] ? parseRef(parts[1]) : s;
    if (!s || !e) return JSON.stringify({ error: 'Invalid range' });
    let count = 0;
    for (let r = s.row; r <= Math.min(e.row, ssR - 1); r++)
      for (let c = s.col; c <= Math.min(e.col, ssC - 1); c++) { ssD[r][c] = ''; count++; }
    LS('sheet', ssD); ssRender();
    toast('Cleared ' + count + ' cells');
    return JSON.stringify({ success: true, cleared: count });
  },

  create_table: async (input) => {
    if (!input.use_current_tab) {
      ssAddPage();
      const page = ssPages.find(p => p.id === ssActivePageId);
      if (page) page.title = 'Claude: ' + (input.title || 'Table');
      saveSsPages(); renderSsTabs();
    }
    const anchor = parseRef(input.anchor || 'A1');
    if (!anchor) return JSON.stringify({ error: 'Invalid anchor' });
    const headers = input.headers || [];
    const rows = input.rows || [];
    const needR = anchor.row + 1 + rows.length;
    const needC = anchor.col + headers.length;
    while (ssR < needR) { ssD.push(new Array(ssC).fill('')); ssR++; }
    while (ssC < needC) { ssD.forEach(r => r.push('')); ssC++; }
    headers.forEach((h, i) => { ssD[anchor.row][anchor.col + i] = h; });
    rows.forEach((row, ri) => {
      row.forEach((val, ci) => { ssD[anchor.row + 1 + ri][anchor.col + ci] = String(val); });
    });
    LS('sheet', ssD); ssSaveCurrentPage(); ssRender();
    toast('Created table: ' + headers.length + ' cols, ' + rows.length + ' rows');
    return JSON.stringify({ success: true, headers: headers.length, rows: rows.length });
  },

  write_note: async (input) => {
    // Agent Memory tab interception
    if (input.label === 'Agent Memory' || (input.use_current_tab && npPages.find(p => p.id === npActivePageId)?.title === 'Agent Memory')) {
      window.appendAgentMemory(input.content.replace(/<[^>]*>/g, ''));
      return JSON.stringify({ success: true, tab: 'Agent Memory' });
    }
    // Page targeting: write to a specific existing page by title
    if (input.target_page) {
      const targetPage = npPages.find(p => p.title.toLowerCase() === input.target_page.toLowerCase());
      if (targetPage) {
        // Switch to the target page
        npSaveCurrentPage();
        npActivePageId = targetPage.id;
        np.innerHTML = targetPage.body || '';
        renderNpTabs();
        if (input.append) {
          np.innerHTML += (np.innerHTML ? '<br>' : '') + input.content;
        } else {
          np.innerHTML = input.content;
        }
        npSaveCurrentPage();
        toast((input.append ? 'Appended to ' : 'Updated ') + targetPage.title);
        return JSON.stringify({ success: true, page: targetPage.title });
      }
      // Target page not found — create it with that name
      npAddPage();
      const newPage = npPages.find(p => p.id === npActivePageId);
      if (newPage) newPage.title = input.target_page;
      saveNpPages(); renderNpTabs();
      np.innerHTML = input.content;
      npSaveCurrentPage();
      toast('Created page: ' + input.target_page);
      return JSON.stringify({ success: true, page: input.target_page, created: true });
    }
    if (!input.use_current_tab && !input.append) {
      npAddPage();
      const page = npPages.find(p => p.id === npActivePageId);
      if (page) page.title = 'Claude: ' + (input.label || 'Note');
      saveNpPages(); renderNpTabs();
    }
    if (input.append) {
      np.innerHTML += (np.innerHTML ? '<br>' : '') + input.content;
    } else {
      np.innerHTML = input.content;
    }
    npSaveCurrentPage();
    toast(input.append ? 'Appended to notepad' : 'Updated notepad');
    return JSON.stringify({ success: true });
  },

  update_graph: async (input) => {
    const GC_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f97316'];
    gcExpressions = (input.expressions || []).map((expr, i) => ({ expr, color: GC_COLORS[i % GC_COLORS.length] }));
    LS('gcExpressions', gcExpressions);
    if (typeof renderGCExprList === 'function') renderGCExprList();
    if (typeof renderGC === 'function') renderGC();
    toast('Updated graph: ' + gcExpressions.length + ' expressions');
    return JSON.stringify({ success: true, count: gcExpressions.length });
  },

  add_stock: async (input) => {
    const t = input.ticker.toUpperCase();
    // Only allow tickers from COMPANY_DB or that have real data available
    const known = typeof COMPANY_DB !== 'undefined' && COMPANY_DB.find(c => c.ticker === t);
    if (!known) {
      // Try to verify via real data before rejecting
      try {
        const realData = await fetchRealStockData(t, '1M');
        if (!realData || realData.length < 2) {
          return JSON.stringify({ error: true, ticker: t, message: 'Ticker ' + t + ' not recognized. Cannot add unknown tickers without live data.' });
        }
      } catch(e) {
        return JSON.stringify({ error: true, ticker: t, message: 'Ticker ' + t + ' not recognized. Cannot add unknown tickers without live data.' });
      }
    }
    if (!stockTickers.includes(t)) { stockTickers.push(t); LS('stockTickers', stockTickers); }
    if (typeof renderStockDash === 'function') renderStockDash();
    if (typeof renderStockChips === 'function') renderStockChips();
    toast('Added ' + t);
    return JSON.stringify({ success: true, ticker: t });
  },

  remove_stock: async (input) => {
    const t = input.ticker.toUpperCase();
    const i = stockTickers.indexOf(t);
    if (i >= 0) { stockTickers.splice(i, 1); LS('stockTickers', stockTickers); }
    if (typeof renderStockDash === 'function') renderStockDash();
    if (typeof renderStockChips === 'function') renderStockChips();
    toast('Removed ' + t);
    return JSON.stringify({ success: true, ticker: t });
  },

  set_comparison: async (input) => {
    compareTickers = [...new Set((input.tickers || []).map(t => t.toUpperCase()))];
    LS('compareTickers', compareTickers);
    if (typeof renderCompareChart === 'function') renderCompareChart();
    toast('Comparison: ' + compareTickers.join(', '));
    return JSON.stringify({ success: true, tickers: compareTickers });
  },

  add_news_ticker: async (input) => {
    const t = input.ticker.toUpperCase();
    if (!newsTickerWatchlist.includes(t)) {
      newsTickerWatchlist.push(t); LS('newsTickers', newsTickerWatchlist);
      if (typeof renderNewsChips === 'function') renderNewsChips();
      if (typeof renderNewsFeed === 'function') renderNewsFeed();
    }
    toast('News: added ' + t);
    return JSON.stringify({ success: true, ticker: t });
  },

  add_concept_node: async (input) => {
    const node = { id: cmNID++, x: 200 + Math.random() * 200, y: 150 + Math.random() * 150, w: 120, h: 50, title: input.title, desc: input.description || '', shape: 'rect', color: '#3b82f6' };
    cmNodes.push(node);
    cmSave(); cmRender();
    toast('Added node: ' + input.title);
    return JSON.stringify({ success: true, id: node.id });
  },

  write_to_draw_pane: async (input) => {
    wbAddLayer('image', input.image_url, { label: input.label || 'Image', w: 250, h: 180 });
    toast('Image added to draw pane');
    return JSON.stringify({ success: true });
  },

  add_text_overlay: async (input) => {
    wbSaveState();
    const sz = input.size || 24;
    wbX.font = 'bold ' + sz + 'px system-ui';
    wbX.fillStyle = '#ffffff';
    wbX.strokeStyle = '#000000';
    wbX.lineWidth = 3;
    wbX.textAlign = 'center';
    let y = sz + 10;
    if (input.position === 'center') y = wbC.height / 2;
    else if (input.position === 'bottom') y = wbC.height - 15;
    wbX.strokeText(input.text, wbC.width / 2, y);
    wbX.fillText(input.text, wbC.width / 2, y);
    return JSON.stringify({ success: true });
  },

  clear_draw_pane: async () => {
    wbSaveState();
    wbX.clearRect(0, 0, wbC.width, wbC.height);
    wbLayers = []; wbRenderLayers();
    toast('Draw pane cleared');
    return JSON.stringify({ success: true });
  },

  show_toast: async (input) => { toast(input.message); return JSON.stringify({ success: true }); },

  // ANALYSIS TOOLS
  run_scenario: async (input) => {
    const t = input.ticker.toUpperCase();
    // Try real data first, fall back to simulated only for known companies
    let data = null, isReal = false;
    try {
      const realData = await fetchRealStockData(t, '1Y');
      if (realData && realData.length >= 2) { data = realData; isReal = true; }
    } catch(e) {}
    if (!data) {
      const known = typeof COMPANY_DB !== 'undefined' && COMPANY_DB.find(c => c.ticker === t);
      if (!known) return JSON.stringify({ error: true, ticker: t, message: 'No data available for ' + t + '. Ticker not recognized and live data unavailable.' });
      data = genStockData(t, '1Y');
    }
    const basePrice = data[data.length - 1];
    const results = (input.scenarios || []).map(s => {
      const projected = [];
      for (let m = 0; m <= 12; m++) {
        projected.push({ month: m, price: +(basePrice * Math.pow(1 + s.growth_rate / 12, m)).toFixed(2) });
      }
      return { name: s.name, growth_rate: s.growth_rate, projected };
    });
    return JSON.stringify({ ticker: t, base_price: basePrice.toFixed(2), scenarios: results, data_source: isReal ? 'Yahoo Finance (live)' : 'Simulated', instruction: 'Build a scenario comparison table in the sheet using create_table. Graph the projected price curves using update_graph. Write a brief scenario analysis to the notepad using write_note with a clear label.' });
  },

  build_thesis: async (input) => {
    const t = input.ticker.toUpperCase();
    // Try real price data first
    let closes = null, isReal = false;
    try {
      const realData = await fetchRealStockData(t, '6M');
      if (realData && realData.length >= 2) { closes = realData; isReal = true; }
    } catch(e) {}
    if (!closes) {
      const known = typeof COMPANY_DB !== 'undefined' && COMPANY_DB.find(c => c.ticker === t);
      if (!known) return JSON.stringify({ error: true, ticker: t, message: 'No data available for ' + t + '. Ticker not recognized and live data unavailable.' });
      closes = genStockData(t, '6M');
    }
    const company = COMPANY_DB.find(c => c.ticker === t);
    const metrics = await getCompanyMetricsReal(t);
    // Try real news via Google News RSS, fall back to simulated
    let articles = [], newsSource = 'simulated';
    try {
      const rssUrl = 'https://news.google.com/rss/search?q=' + encodeURIComponent(t + ' stock') + '&hl=en-US&gl=US&ceid=US:en';
      let resp;
      try { resp = await fetch(PROXY_BASE + '/proxy/news?url=' + encodeURIComponent(rssUrl)); } catch (_) {
        resp = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(rssUrl));
      }
      const xmlText = await resp.text();
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      const items = doc.querySelectorAll('item');
      items.forEach((item, idx) => {
        if (idx >= 5) return;
        articles.push({ title: item.querySelector('title')?.textContent || '', source: item.querySelector('source')?.textContent || '' });
      });
      if (articles.length > 0) newsSource = 'Google News (live)';
    } catch(e) {}
    if (!articles.length) articles = genNews(t).slice(0, 5);
    const thesis = {
      ticker: t,
      company: company ? company.name : t,
      sector: company ? company.sector : 'Unknown',
      current_price: metrics.price.toFixed(2),
      market_cap: formatCap(metrics.mktCap),
      six_month_range: Math.min(...closes).toFixed(2) + ' - ' + Math.max(...closes).toFixed(2),
      six_month_return: (((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(1) + '%',
      recent_news: articles.map(a => a.title || a),
      fundamentals: metrics,
      data_sources: { price: isReal ? 'Yahoo Finance (live)' : 'Simulated', news: newsSource, fundamentals: 'Yahoo Finance' },
      instruction: 'Synthesize this data into a structured investment thesis. Write it to the notepad using write_note with label "Thesis: ' + t + '". Include: 1) Company overview, 2) Price action analysis citing the 6-month range/return, 3) Fundamental analysis citing PE/market cap/growth, 4) News sentiment from recent headlines, 5) Bull/bear case, 6) Conclusion with rating. Also build a summary table in the sheet.'
    };
    return JSON.stringify(thesis);
  },

  sentiment_summary: async (input) => {
    // Try real news first via Google News RSS
    let articles = [], newsSource = 'simulated';
    try {
      const rssUrl = 'https://news.google.com/rss/search?q=' + encodeURIComponent(input.keyword) + '&hl=en-US&gl=US&ceid=US:en';
      let resp;
      try { resp = await fetch(PROXY_BASE + '/proxy/news?url=' + encodeURIComponent(rssUrl)); } catch (_) {
        resp = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(rssUrl));
      }
      const xmlText = await resp.text();
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      const items = doc.querySelectorAll('item');
      items.forEach((item, idx) => {
        if (idx >= 15) return;
        const title = item.querySelector('title')?.textContent || '';
        const source = item.querySelector('source')?.textContent || '';
        articles.push({ title, snippet: title, source });
      });
      if (articles.length > 0) newsSource = 'Google News (live)';
    } catch(e) {}
    if (!articles.length) articles = genNews(input.keyword);
    const positive = ['strong', 'growth', 'beat', 'surge', 'rally', 'record', 'expands', 'innovation', 'upgrade', 'bullish', 'outperform', 'gain', 'profit', 'soar', 'boost'];
    const negative = ['fall', 'decline', 'risk', 'cut', 'warning', 'probe', 'layoff', 'miss', 'downgrade', 'bearish', 'loss', 'crash', 'slump', 'weak', 'concern'];
    let posCount = 0, negCount = 0;
    articles.forEach(a => {
      const text = (a.title + ' ' + (a.snippet || '')).toLowerCase();
      positive.forEach(w => { if (text.includes(w)) posCount++; });
      negative.forEach(w => { if (text.includes(w)) negCount++; });
    });
    const total = posCount + negCount || 1;
    const score = ((posCount - negCount) / total * 100).toFixed(0);
    return JSON.stringify({ keyword: input.keyword, articles_analyzed: articles.length, positive_signals: posCount, negative_signals: negCount, sentiment_score: +score, rating: score > 30 ? 'Bullish' : score < -30 ? 'Bearish' : 'Neutral', headlines: articles.slice(0, 5).map(a => a.title), data_source: newsSource, instruction: 'Present these sentiment findings clearly. Write a sentiment report to the notepad using write_note. If other research data exists (thesis, price data), consolidate findings into a unified view. Build a sentiment summary row in any existing analysis table in the sheet.' });
  },

  create_template: async (input) => {
    const anchor = parseRef(input.anchor_cell || 'A1') || { row: 0, col: 0 };
    const templates = {
      stock_comparison_table: { headers: ['Ticker', 'Price', 'Change %', 'Mkt Cap', 'PE', 'Sector'], rows: [['AAPL', '', '', '', '', ''], ['MSFT', '', '', '', '', ''], ['GOOGL', '', '', '', '', ''], ['AMZN', '', '', '', '', '']] },
      earnings_tracker: { headers: ['Ticker', 'Report Date', 'EPS Est', 'EPS Actual', 'Surprise %', 'Revenue', 'Guidance'], rows: [['', '', '', '', '', '', ''], ['', '', '', '', '', '', ''], ['', '', '', '', '', '', '']] },
      portfolio_summary: { headers: ['Ticker', 'Shares', 'Avg Cost', 'Current', 'Value', 'Gain/Loss', 'Weight %'], rows: [['', '', '', '', '', '', ''], ['', '', '', '', '', '', ''], ['', '', '', '', '', '', ''], ['', 'TOTAL', '', '', '=SUM(E' + (anchor.row + 2) + ':E' + (anchor.row + 4) + ')', '', '100%']] },
      scenario_model: { headers: ['Month', 'Bear (-10%)', 'Base (5%)', 'Bull (20%)'], rows: Array.from({length: 12}, (_, i) => [String(i + 1), '', '', '']) },
      news_sentiment_board: { headers: ['Source', 'Headline', 'Sentiment', 'Score', 'Date'], rows: [['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']] },
      macro_dashboard: { headers: ['Indicator', 'Current', 'Previous', 'Trend', 'Impact'], rows: [['CPI', '', '', '', ''], ['Fed Rate', '', '', '', ''], ['VIX', '', '', '', ''], ['10Y Yield', '', '', '', ''], ['Unemployment', '', '', '', '']] }
    };
    const tpl = templates[input.type];
    if (!tpl) return JSON.stringify({ error: 'Unknown template: ' + input.type });
    while (ssR < anchor.row + 1 + tpl.rows.length) { ssD.push(new Array(ssC).fill('')); ssR++; }
    while (ssC < anchor.col + tpl.headers.length) { ssD.forEach(r => r.push('')); ssC++; }
    tpl.headers.forEach((h, i) => { ssD[anchor.row][anchor.col + i] = h; });
    tpl.rows.forEach((row, ri) => { row.forEach((val, ci) => { ssD[anchor.row + 1 + ri][anchor.col + ci] = val; }); });
    LS('sheet', ssD); ssRender();
    toast('Template: ' + input.type);
    return JSON.stringify({ success: true, type: input.type });
  },

  // IMAGE/MEME TOOLS
  search_image: async (input) => {
    const urls = [];
    for (let i = 0; i < 6; i++) urls.push('https://picsum.photos/seed/' + encodeURIComponent(input.query + i) + '/400/300');
    return JSON.stringify({ query: input.query, urls });
  },

  create_meme: async (input) => {
    const IMGFLIP_TEMPLATES = {
      drake: 181913649, stonks: 326428803, this_is_fine: 55311130,
      galaxy_brain: 262867959, disaster_girl: 97984, expanding_brain: 93895088,
      trade_offer: 309868304, change_my_mind: 129242436, always_has_been: 252600902,
      distracted_boyfriend: 112126428, gru_plan: 131940431, hide_the_pain: 27813981
    };
    const templateId = IMGFLIP_TEMPLATES[input.template_name] || IMGFLIP_TEMPLATES['stonks'];
    try {
      const formData = new URLSearchParams({
        template_id: templateId,
        username: 'imgflip_hubot',
        password: 'imgflip_hubot',
        text0: input.top_text || '',
        text1: input.bottom_text || ''
      });
      const memeResp = await fetch('https://api.imgflip.com/caption_image', {
        method: 'POST', body: formData
      });
      const memeData = await memeResp.json();
      if (memeData.success) {
        wbAddLayer('image', memeData.data.url, { label: 'Meme: ' + input.template_name, w: 300, h: 300, x: 30, y: 30 });
        toast('Meme created!');
        return JSON.stringify({ success: true, url: memeData.data.url });
      }
      return JSON.stringify({ error: memeData.error_message || 'imgflip API failed' });
    } catch (err) {
      return JSON.stringify({ error: 'imgflip API error: ' + err.message });
    }
  },

  // PRICING ANALYSIS
  pricing_analysis: async (input) => {
    const model = $('#pricingModel')?.value || $('#aiModel').value;
    const rates = MODEL_RATES[model] || MODEL_RATES['claude-sonnet-4-6'];
    const users = input.target_users || +($('#pricingUsers')?.value || 100);
    const qpu = input.queries_per_user || +($('#pricingQpu')?.value || 20);
    const mixQA = +($('#pricingMixQA')?.value || 40);
    const mixTool = +($('#pricingMixTool')?.value || 30);
    const mixMulti = +($('#pricingMixMulti')?.value || 20);
    const mixDeep = +($('#pricingMixDeep')?.value || 10);
    const mixTotal = mixQA + mixTool + mixMulti + mixDeep || 100;
    function pqCost(profile) {
      const p = PRICING_TOKEN_PROFILES[profile];
      return (p.inputTokens / 1e6 * rates.input) + (p.outputTokens / 1e6 * rates.output);
    }
    const blendedCost = (pqCost('qa') * mixQA + pqCost('tool') * mixTool + pqCost('multi') * mixMulti + pqCost('deep') * mixDeep) / mixTotal;
    const scenarios = [10, 100, 500, 1000, 5000, 10000, 50000].map(u => {
      const totalQ = u * qpu;
      return { users: u, totalQueries: totalQ, monthlyCost: +(blendedCost * totalQ).toFixed(2), costPerUser: +(blendedCost * qpu).toFixed(4), annualCost: +(blendedCost * totalQ * 12).toFixed(2) };
    });
    toast('Pricing analysis: ' + scenarios.length + ' scenarios');
    return JSON.stringify({
      model, rates, blendedCostPerQuery: +blendedCost.toFixed(6), scenarios,
      queryMix: { qa: mixQA, tool: mixTool, multi: mixMulti, deep: mixDeep },
      product_type: input.product_type,
      competitors: input.competitors || '',
      instruction: 'Analyze these cost scenarios. Build a pricing comparison table in the sheet using write_cells or create_table. Write a pricing strategy recommendation to the notepad using write_note. Consider: unit economics at each scale, margin requirements, competitive positioning, adoption incentives (freemium/trial), and path to profitability. Show break-even pricing and suggested tiers.'
    });
  },

  // DEEP RESEARCH
  deep_research: async (input) => {
    try {
      const rssUrl = 'https://news.google.com/rss/search?q=' + encodeURIComponent(input.topic) + '&hl=en-US&gl=US&ceid=US:en';
      let toolProxyUrl = PROXY_BASE + '/proxy/news?url=' + encodeURIComponent(rssUrl);
      let resp;
      try { resp = await fetch(toolProxyUrl); } catch (_) {
        toolProxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(rssUrl);
        resp = await fetch(toolProxyUrl);
      }
      const xmlText = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const items = doc.querySelectorAll('item');
      const articles = [];
      items.forEach((item, idx) => {
        if (idx >= 15) return;
        articles.push({
          title: item.querySelector('title')?.textContent || '',
          source: item.querySelector('source')?.textContent || '',
          date: item.querySelector('pubDate')?.textContent || '',
          link: item.querySelector('link')?.textContent || ''
        });
      });
      toast('Deep research: fetched ' + articles.length + ' articles');
      return JSON.stringify({ topic: input.topic, articles_found: articles.length, articles, instruction: 'Analyze these real articles and synthesize findings. Write a structured report to the notepad using write_note.' });
    } catch (err) {
      return JSON.stringify({ error: 'Research fetch failed: ' + err.message });
    }
  },

  // WHITEBOARD TOOLS — Phase 6
  get_draw_pane_state: async () => {
    // Enhanced whiteboard state with spatial awareness
    const layers = wbLayers.map(l => ({
      id: l.id, type: l.type, label: l.label,
      x: l.x, y: l.y, w: l.w, h: l.h,
      category: l.category || l.type,
      source: l.source || 'user',
      group: l.group || null,
      visible: l.visible
    }));
    // Compute occupied vs free regions
    const cw = wbC.width, ch = wbC.height;
    const occupied = layers.filter(l => l.visible).map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h }));
    // Find largest free rectangle (simplified: check top/bottom/left/right margins)
    const usedMinX = occupied.length ? Math.min(...occupied.map(r => r.x)) : cw;
    const usedMaxX = occupied.length ? Math.max(...occupied.map(r => r.x + r.w)) : 0;
    const usedMinY = occupied.length ? Math.min(...occupied.map(r => r.y)) : ch;
    const usedMaxY = occupied.length ? Math.max(...occupied.map(r => r.y + r.h)) : 0;
    // Get multi-page info
    const pages = (typeof wbPages !== 'undefined' && wbPages) ? wbPages.map(p => ({ id: p.id, title: p.title })) : [];
    const activePageId = typeof wbActivePageId !== 'undefined' ? wbActivePageId : null;

    return JSON.stringify({
      layerCount: wbLayers.length,
      layers,
      canvasWidth: cw,
      canvasHeight: ch,
      isEmpty: wbLayers.length === 0,
      freeRegions: {
        right: { x: usedMaxX + 20, y: 0, w: cw - usedMaxX - 20, h: ch },
        bottom: { x: 0, y: usedMaxY + 20, w: cw, h: ch - usedMaxY - 20 },
        left: { x: 0, y: 0, w: Math.max(0, usedMinX - 20), h: ch },
        top: { x: 0, y: 0, w: cw, h: Math.max(0, usedMinY - 20) }
      },
      groups: [...new Set(wbLayers.filter(l => l.group).map(l => l.group))],
      pages,
      activePageId
    });
  },

  draw_shape: async (input) => {
    // ADDED — Phase 6: Draw primitive shape on whiteboard
    wbSaveState();
    const x = input.x || 0, y = input.y || 0;
    const w = input.width || 100, h = input.height || 100;
    const color = input.color || '#3b82f6';
    const sw = Math.min(Math.max(input.strokeWidth || 2, 1), 10);
    wbX.save();
    wbX.strokeStyle = color;
    wbX.lineWidth = sw;
    if (input.fill) wbX.fillStyle = input.fill;

    switch (input.shape) {
      case 'rect':
        if (input.fill) wbX.fillRect(x, y, w, h);
        wbX.strokeRect(x, y, w, h);
        break;
      case 'circle': {
        const rx = w / 2, ry = h / 2;
        wbX.beginPath();
        wbX.ellipse(x + rx, y + ry, rx, ry, 0, 0, Math.PI * 2);
        if (input.fill) wbX.fill();
        wbX.stroke();
        break;
      }
      case 'line':
        wbX.beginPath();
        wbX.moveTo(x, y);
        wbX.lineTo(input.x2 || x + 100, input.y2 || y);
        wbX.stroke();
        break;
      case 'arrow': {
        const x2 = input.x2 || x + 100, y2 = input.y2 || y;
        wbX.beginPath();
        wbX.moveTo(x, y);
        wbX.lineTo(x2, y2);
        wbX.stroke();
        // Arrowhead
        const angle = Math.atan2(y2 - y, x2 - x);
        const headLen = 10 + sw;
        wbX.beginPath();
        wbX.moveTo(x2, y2);
        wbX.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
        wbX.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
        wbX.closePath();
        wbX.fillStyle = color;
        wbX.fill();
        break;
      }
    }
    // Label
    if (input.label) {
      wbX.fillStyle = color;
      wbX.font = '14px system-ui';
      wbX.textAlign = 'center';
      wbX.textBaseline = 'middle';
      const cx = (input.shape === 'line' || input.shape === 'arrow') ? (x + (input.x2 || x + 100)) / 2 : x + w / 2;
      const cy = (input.shape === 'line' || input.shape === 'arrow') ? (y + (input.y2 || y)) / 2 - 12 : y + h / 2;
      wbX.fillText(input.label, cx, cy);
    }
    wbX.restore();
    wbAddLayer('chart', null, { label: input.layerName || 'Shape', x, y, w, h, source: 'bot', category: 'shape' });
    toast('Drew ' + input.shape);
    return JSON.stringify({ success: true, shape: input.shape });
  },

  draw_chart_on_whiteboard: async (input) => {
    // ADDED — Phase 6: Render Chart.js chart on whiteboard
    if (typeof Chart === 'undefined') return JSON.stringify({ error: 'Chart.js not loaded' });
    const cw = input.width || 400, ch = input.height || 300;
    const offscreen = document.createElement('canvas');
    offscreen.width = cw; offscreen.height = ch;
    const offCtx = offscreen.getContext('2d');
    const chartType = input.chartType === 'donut' ? 'doughnut' : input.chartType;
    const datasets = (input.datasets || []).map(ds => ({
      label: ds.label,
      data: ds.values,
      backgroundColor: ds.color,
      borderColor: ds.color,
      borderWidth: 1,
      fill: chartType === 'line' ? false : undefined
    }));
    const config = {
      type: chartType,
      data: { labels: input.labels || [], datasets },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          title: { display: true, text: input.title || '', color: '#fff', font: { size: 14 } },
          legend: { display: input.showLegend !== false, labels: { color: '#ccc' } },
          datalabels: input.showValues ? { display: true, color: '#fff' } : undefined
        },
        scales: (chartType !== 'pie' && chartType !== 'doughnut') ? {
          x: { ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,.1)' } },
          y: { ticks: { color: '#ccc' }, grid: { color: 'rgba(255,255,255,.1)' } }
        } : undefined
      }
    };
    // Render chart
    const chart = new Chart(offCtx, config);
    // Draw onto whiteboard
    wbSaveState();
    wbX.drawImage(offscreen, input.x || 0, input.y || 0, cw, ch);
    chart.destroy();
    wbAddLayer('chart', null, { label: input.layerName || 'Chart', x: input.x || 0, y: input.y || 0, w: cw, h: ch, source: 'bot', category: 'chart' });
    toast('Chart drawn on whiteboard');
    return JSON.stringify({ success: true, chartType: input.chartType });
  },

  annotate_whiteboard: async (input) => {
    // ADDED — Phase 6: Callout annotation with arrow
    wbSaveState();
    const tx = input.targetX, ty = input.targetY;
    const lx = input.labelX, ly = input.labelY;
    const arrowColor = input.arrowColor || '#ef4444';
    const boxColor = input.boxColor || '#1e293b';
    const textColor = input.textColor || '#ffffff';
    const fontSize = Math.min(Math.max(input.fontSize || 14, 12), 24);

    wbX.save();
    // Draw curved arrow
    const cpx = (lx + tx) / 2, cpy = Math.min(ly, ty) - 30;
    wbX.beginPath();
    wbX.moveTo(lx, ly);
    wbX.quadraticCurveTo(cpx, cpy, tx, ty);
    wbX.strokeStyle = arrowColor;
    wbX.lineWidth = 2;
    wbX.stroke();
    // Arrowhead
    const angle = Math.atan2(ty - cpy, tx - cpx);
    wbX.beginPath();
    wbX.moveTo(tx, ty);
    wbX.lineTo(tx - 10 * Math.cos(angle - 0.4), ty - 10 * Math.sin(angle - 0.4));
    wbX.lineTo(tx - 10 * Math.cos(angle + 0.4), ty - 10 * Math.sin(angle + 0.4));
    wbX.closePath();
    wbX.fillStyle = arrowColor;
    wbX.fill();
    // Text box
    wbX.font = fontSize + 'px system-ui';
    const textW = wbX.measureText(input.text).width + 16;
    const textH = fontSize + 12;
    const bx = lx - textW / 2, by = ly - textH / 2;
    wbX.fillStyle = boxColor;
    wbX.beginPath();
    wbX.roundRect(bx, by, textW, textH, 6);
    wbX.fill();
    wbX.strokeStyle = arrowColor;
    wbX.lineWidth = 1;
    wbX.stroke();
    // Text
    wbX.fillStyle = textColor;
    wbX.textAlign = 'center';
    wbX.textBaseline = 'middle';
    wbX.fillText(input.text, lx, ly);
    wbX.restore();

    wbAddLayer('chart', null, { label: input.layerName || 'Annotation', x: Math.min(lx, tx) - 20, y: Math.min(ly, ty) - 30, w: Math.abs(tx - lx) + 40, h: Math.abs(ty - ly) + 60, source: 'bot', category: 'annotation' });
    toast('Annotation added');
    return JSON.stringify({ success: true });
  },

  draw_summary_card: async (input) => {
    // ADDED — Phase 6: Styled summary card
    wbSaveState();
    const x = input.x || 0, y = input.y || 0;
    const w = input.width || 250;
    const items = input.items || [];
    const headerH = 32;
    const lineH = 22;
    const padding = 12;
    const h = headerH + padding + items.length * lineH + padding;
    const accent = input.accentColor || '#3b82f6';
    const style = input.style || 'dark';
    const bgColors = { dark: '#1a1a2e', light: '#f0f0f0', accent: accent };
    const textColors = { dark: '#e2e8f0', light: '#1a1a2e', accent: '#ffffff' };
    const bg = bgColors[style] || bgColors.dark;
    const fg = textColors[style] || textColors.dark;

    wbX.save();
    // Card background
    wbX.fillStyle = bg;
    wbX.beginPath();
    wbX.roundRect(x, y, w, h, 8);
    wbX.fill();
    // Header bar
    wbX.fillStyle = accent;
    wbX.beginPath();
    wbX.roundRect(x, y, w, headerH, [8, 8, 0, 0]);
    wbX.fill();
    // Title
    wbX.fillStyle = '#ffffff';
    wbX.font = 'bold 14px system-ui';
    wbX.textAlign = 'left';
    wbX.textBaseline = 'middle';
    wbX.fillText(input.title, x + 10, y + headerH / 2);
    // Divider
    wbX.strokeStyle = 'rgba(255,255,255,.2)';
    wbX.lineWidth = 1;
    wbX.beginPath();
    wbX.moveTo(x + 8, y + headerH);
    wbX.lineTo(x + w - 8, y + headerH);
    wbX.stroke();
    // Items
    wbX.fillStyle = fg;
    wbX.font = '12px system-ui';
    items.forEach((item, i) => {
      const iy = y + headerH + padding + i * lineH;
      wbX.fillText('\u2022 ' + item, x + 12, iy + lineH / 2);
    });
    wbX.restore();

    wbAddLayer('chart', null, { label: input.layerName || 'Summary Card', x, y, w, h, source: 'bot', category: 'card' });
    toast('Summary card drawn');
    return JSON.stringify({ success: true, items: items.length });
  },

  // WHITEBOARD ENHANCEMENT TOOLS
  draw_table: async (input) => {
    wbSaveState();
    const headers = input.headers || [];
    const rows = input.rows || [];
    const x = input.x || 0, y = input.y || 0;
    const w = input.width || Math.max(300, headers.length * 100);
    const rowH = 28, headerH = 32, padding = 8;
    const h = headerH + rows.length * rowH + padding;
    const colW = w / headers.length;
    const accent = input.headerColor || '#3b82f6';
    const style = input.style || 'dark';
    const bg = style === 'light' ? '#f0f0f0' : style === 'accent' ? accent + '22' : '#1a1a2e';
    const fg = style === 'light' ? '#1a1a2e' : '#e2e8f0';
    const altRow = style === 'light' ? 'rgba(0,0,0,.04)' : 'rgba(255,255,255,.04)';

    wbX.save();
    // Table background
    wbX.fillStyle = bg;
    wbX.beginPath(); wbX.roundRect(x, y, w, h, 6); wbX.fill();
    // Header bar
    wbX.fillStyle = accent;
    wbX.beginPath(); wbX.roundRect(x, y, w, headerH, [6, 6, 0, 0]); wbX.fill();
    // Header text
    wbX.fillStyle = '#ffffff';
    wbX.font = 'bold 12px system-ui';
    wbX.textAlign = 'left'; wbX.textBaseline = 'middle';
    headers.forEach((hdr, ci) => {
      wbX.fillText(hdr, x + ci * colW + 8, y + headerH / 2);
    });
    // Column dividers
    wbX.strokeStyle = 'rgba(255,255,255,.15)'; wbX.lineWidth = 0.5;
    for (let ci = 1; ci < headers.length; ci++) {
      wbX.beginPath(); wbX.moveTo(x + ci * colW, y); wbX.lineTo(x + ci * colW, y + h); wbX.stroke();
    }
    // Data rows
    wbX.font = '11px system-ui'; wbX.fillStyle = fg;
    rows.forEach((row, ri) => {
      const ry = y + headerH + ri * rowH;
      // Alternating row background
      if (ri % 2 === 1) { wbX.fillStyle = altRow; wbX.fillRect(x, ry, w, rowH); wbX.fillStyle = fg; }
      // Row divider
      wbX.strokeStyle = 'rgba(255,255,255,.08)'; wbX.beginPath(); wbX.moveTo(x, ry); wbX.lineTo(x + w, ry); wbX.stroke();
      // Cell text
      row.forEach((cell, ci) => {
        wbX.fillStyle = fg;
        wbX.fillText(String(cell || ''), x + ci * colW + 8, ry + rowH / 2);
      });
    });
    wbX.restore();

    wbAddLayer('chart', null, { label: input.layerName || 'Table', x, y, w, h, source: 'bot', category: 'table' });
    toast('Table drawn on whiteboard');
    return JSON.stringify({ success: true, headers: headers.length, rows: rows.length });
  },

  align_layers: async (input) => {
    const ids = input.layerIds;
    const layers = ids ? wbLayers.filter(l => ids.includes(l.id)) : wbLayers.slice();
    if (layers.length < 2) return JSON.stringify({ error: 'Need at least 2 layers to align' });

    const align = input.alignment;
    if (align === 'left') { const minX = Math.min(...layers.map(l => l.x)); layers.forEach(l => l.x = minX); }
    else if (align === 'right') { const maxR = Math.max(...layers.map(l => l.x + l.w)); layers.forEach(l => l.x = maxR - l.w); }
    else if (align === 'center') { const avgCx = layers.reduce((s, l) => s + l.x + l.w / 2, 0) / layers.length; layers.forEach(l => l.x = avgCx - l.w / 2); }
    else if (align === 'top') { const minY = Math.min(...layers.map(l => l.y)); layers.forEach(l => l.y = minY); }
    else if (align === 'bottom') { const maxB = Math.max(...layers.map(l => l.y + l.h)); layers.forEach(l => l.y = maxB - l.h); }
    else if (align === 'middle') { const avgCy = layers.reduce((s, l) => s + l.y + l.h / 2, 0) / layers.length; layers.forEach(l => l.y = avgCy - l.h / 2); }
    else if (align === 'distribute-h') {
      layers.sort((a, b) => a.x - b.x);
      const minX = layers[0].x, maxX = layers[layers.length - 1].x;
      const step = (maxX - minX) / (layers.length - 1);
      layers.forEach((l, i) => l.x = minX + i * step);
    } else if (align === 'distribute-v') {
      layers.sort((a, b) => a.y - b.y);
      const minY = layers[0].y, maxY = layers[layers.length - 1].y;
      const step = (maxY - minY) / (layers.length - 1);
      layers.forEach((l, i) => l.y = minY + i * step);
    }

    wbRenderLayers(); wbRenderLayerList();
    toast('Layers aligned: ' + align);
    return JSON.stringify({ success: true, alignment: align, layersAffected: layers.length });
  },

  group_layers: async (input) => {
    const ids = input.layerIds || [];
    const name = input.groupName;
    let count = 0;
    wbLayers.forEach(l => { if (ids.includes(l.id)) { l.group = name; count++; } });
    wbRenderLayerList();
    toast('Grouped ' + count + ' layers as "' + name + '"');
    return JSON.stringify({ success: true, groupName: name, layersGrouped: count });
  },

  ungroup_layers: async (input) => {
    const name = input.groupName;
    let count = 0;
    wbLayers.forEach(l => { if (l.group === name) { l.group = null; count++; } });
    wbRenderLayerList();
    toast('Ungrouped "' + name + '" (' + count + ' layers)');
    return JSON.stringify({ success: true, groupName: name, layersUngrouped: count });
  },

  apply_whiteboard_template: async (input) => {
    const cw = wbC.width, ch = wbC.height;
    const pad = 20, gap = 16;
    const title = input.title || 'Untitled';
    const template = input.template;
    let regions = {};

    wbSaveState();
    wbX.save();

    // Draw template title bar
    const titleH = 40;
    wbX.fillStyle = '#1e293b';
    wbX.fillRect(0, 0, cw, titleH);
    wbX.fillStyle = '#3b82f6';
    wbX.fillRect(0, titleH - 3, cw, 3);
    wbX.fillStyle = '#ffffff';
    wbX.font = 'bold 16px system-ui';
    wbX.textAlign = 'left'; wbX.textBaseline = 'middle';
    wbX.fillText(title, pad, titleH / 2);

    const contentY = titleH + gap;
    const contentH = ch - contentY - pad;
    const contentW = cw - pad * 2;

    if (template === 'dashboard') {
      // 2x2 grid
      const halfW = (contentW - gap) / 2, halfH = (contentH - gap) / 2;
      regions = {
        topLeft: { x: pad, y: contentY, w: halfW, h: halfH },
        topRight: { x: pad + halfW + gap, y: contentY, w: halfW, h: halfH },
        bottomLeft: { x: pad, y: contentY + halfH + gap, w: halfW, h: halfH },
        bottomRight: { x: pad + halfW + gap, y: contentY + halfH + gap, w: halfW, h: halfH }
      };
    } else if (template === 'presentation') {
      // Large content + footer
      const footerH = 50;
      regions = {
        content: { x: pad, y: contentY, w: contentW, h: contentH - footerH - gap },
        footer: { x: pad, y: ch - pad - footerH, w: contentW, h: footerH }
      };
    } else if (template === 'comparison') {
      // Side-by-side panels
      const halfW = (contentW - gap) / 2;
      regions = {
        left: { x: pad, y: contentY, w: halfW, h: contentH },
        right: { x: pad + halfW + gap, y: contentY, w: halfW, h: contentH }
      };
    } else if (template === 'hierarchy') {
      // Top row (1) + middle row (2-3) + bottom row
      const topH = contentH * 0.25, midH = contentH * 0.35, botH = contentH * 0.3;
      const thirdW = (contentW - gap * 2) / 3;
      regions = {
        top: { x: pad + contentW / 3, y: contentY, w: contentW / 3, h: topH },
        midLeft: { x: pad, y: contentY + topH + gap, w: thirdW, h: midH },
        midCenter: { x: pad + thirdW + gap, y: contentY + topH + gap, w: thirdW, h: midH },
        midRight: { x: pad + thirdW * 2 + gap * 2, y: contentY + topH + gap, w: thirdW, h: midH }
      };
    } else if (template === 'timeline') {
      // Horizontal flow with milestones
      const laneH = contentH * 0.6;
      const laneY = contentY + (contentH - laneH) / 2;
      // Draw timeline line
      wbX.strokeStyle = '#3b82f6'; wbX.lineWidth = 3;
      wbX.beginPath(); wbX.moveTo(pad, laneY + laneH / 2); wbX.lineTo(cw - pad, laneY + laneH / 2); wbX.stroke();
      // 5 milestone slots
      const slots = 5;
      const slotW = (contentW - gap * (slots - 1)) / slots;
      regions = {};
      for (let i = 0; i < slots; i++) {
        regions['slot' + (i + 1)] = { x: pad + i * (slotW + gap), y: laneY, w: slotW, h: laneH };
        // Draw milestone dot
        wbX.beginPath();
        wbX.arc(pad + i * (slotW + gap) + slotW / 2, laneY + laneH / 2, 6, 0, Math.PI * 2);
        wbX.fillStyle = '#3b82f6'; wbX.fill();
      }
    }

    // Draw region outlines (subtle guides)
    wbX.strokeStyle = 'rgba(59,130,246,.2)'; wbX.lineWidth = 1; wbX.setLineDash([4, 4]);
    Object.values(regions).forEach(r => { wbX.strokeRect(r.x, r.y, r.w, r.h); });
    wbX.setLineDash([]);
    wbX.restore();

    wbAddLayer('chart', null, { label: input.layerName || 'Template: ' + template, x: 0, y: 0, w: cw, h: ch, source: 'bot', category: 'shape' });
    toast('Template applied: ' + template);
    return JSON.stringify({ success: true, template, regions, canvasWidth: cw, canvasHeight: ch });
  },

  // CONCEPT MAP TOOLS — Phase 7
  add_concept_edge: async (input) => {
    // ADDED — Phase 7: Connect nodes with labeled edge
    const src = cmNodes.find(n => n.title === input.sourceLabel);
    const tgt = cmNodes.find(n => n.title === input.targetLabel);
    if (!src) return JSON.stringify({ error: 'Source node not found: ' + input.sourceLabel });
    if (!tgt) return JSON.stringify({ error: 'Target node not found: ' + input.targetLabel });
    const edge = {
      from: src.id,
      to: tgt.id,
      label: input.edgeLabel || '',
      style: input.edgeStyle || 'solid',
      color: input.color || '#94a3b8',
      directed: input.directed !== false
    };
    cmEdges.push(edge);
    cmSave(); cmRender();
    toast('Connected: ' + input.sourceLabel + ' → ' + input.targetLabel);
    return JSON.stringify({ success: true, from: src.id, to: tgt.id });
  },

  remove_concept_node: async (input) => {
    // ADDED — Phase 7: Remove node and optionally connected edges
    const node = cmNodes.find(n => n.title === input.label);
    if (!node) return JSON.stringify({ removed: false, edgesRemoved: 0, label: input.label, error: 'Node not found' });
    const id = node.id;
    cmNodes = cmNodes.filter(n => n.id !== id);
    let edgesRemoved = 0;
    if (input.removeOrphanedEdges) {
      const before = cmEdges.length;
      cmEdges = cmEdges.filter(e => e.from !== id && e.to !== id);
      edgesRemoved = before - cmEdges.length;
    }
    cmSave(); cmRender();
    toast('Removed node: ' + input.label);
    return JSON.stringify({ removed: true, edgesRemoved, label: input.label });
  },

  clear_concept_map: async (input) => {
    // ADDED — Phase 7: Wipe concept map
    if (!input.confirm) return JSON.stringify({ cleared: false, reason: 'confirm must be true' });
    const nodesRemoved = cmNodes.length;
    const edgesRemoved = cmEdges.length;
    cmNodes = []; cmEdges = [];
    cmSave(); cmRender();
    toast('Concept map cleared');
    return JSON.stringify({ cleared: true, nodesRemoved, edgesRemoved });
  },

  set_concept_map_layout: async (input) => {
    // ADDED — Phase 7: Reposition nodes with layout algorithm
    if (!cmNodes.length) return JSON.stringify({ layout: input.layout, nodesRepositioned: 0 });
    const cw = cmC.width || 600, ch = cmC.height || 400;
    const pad = 60;

    switch (input.layout) {
      case 'radial': {
        // Hub = node with most connections
        const edgeCounts = {};
        cmNodes.forEach(n => edgeCounts[n.id] = 0);
        cmEdges.forEach(e => { edgeCounts[e.from] = (edgeCounts[e.from] || 0) + 1; edgeCounts[e.to] = (edgeCounts[e.to] || 0) + 1; });
        const hub = cmNodes.reduce((a, b) => (edgeCounts[a.id] || 0) >= (edgeCounts[b.id] || 0) ? a : b);
        hub.x = cw / 2 - hub.w / 2;
        hub.y = ch / 2 - hub.h / 2;
        const others = cmNodes.filter(n => n !== hub);
        const radius = Math.min(cw, ch) / 2 - pad;
        others.forEach((n, i) => {
          const angle = (2 * Math.PI * i) / others.length;
          n.x = cw / 2 + radius * Math.cos(angle) - n.w / 2;
          n.y = ch / 2 + radius * Math.sin(angle) - n.h / 2;
        });
        break;
      }
      case 'tree': {
        // Root = node with no incoming edges
        const incoming = new Set(cmEdges.map(e => e.to));
        const root = cmNodes.find(n => !incoming.has(n.id)) || cmNodes[0];
        // BFS levels
        const visited = new Set([root.id]);
        const levels = [[root]];
        while (true) {
          const prev = levels[levels.length - 1];
          const next = [];
          for (const n of prev) {
            for (const e of cmEdges) {
              const childId = e.from === n.id ? e.to : (e.to === n.id ? e.from : null);
              if (childId && !visited.has(childId)) {
                const child = cmNodes.find(nd => nd.id === childId);
                if (child) { next.push(child); visited.add(childId); }
              }
            }
          }
          if (!next.length) break;
          levels.push(next);
        }
        // Add unvisited
        cmNodes.filter(n => !visited.has(n.id)).forEach(n => { levels.push([n]); visited.add(n.id); });
        const levelH = (ch - 2 * pad) / Math.max(levels.length - 1, 1);
        levels.forEach((level, li) => {
          const spacing = (cw - 2 * pad) / Math.max(level.length, 1);
          level.forEach((n, ni) => {
            n.x = pad + spacing * ni + spacing / 2 - n.w / 2;
            n.y = pad + levelH * li;
          });
        });
        break;
      }
      case 'force': {
        // Simple force-directed: 50 iterations
        for (let iter = 0; iter < 50; iter++) {
          // Repulsion between all pairs
          for (let i = 0; i < cmNodes.length; i++) {
            for (let j = i + 1; j < cmNodes.length; j++) {
              const a = cmNodes[i], b = cmNodes[j];
              let dx = (b.x + b.w / 2) - (a.x + a.w / 2);
              let dy = (b.y + b.h / 2) - (a.y + a.h / 2);
              const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
              const force = 5000 / (dist * dist);
              dx = dx / dist * force;
              dy = dy / dist * force;
              a.x -= dx; a.y -= dy;
              b.x += dx; b.y += dy;
            }
          }
          // Attraction along edges
          cmEdges.forEach(e => {
            const a = cmNodes.find(n => n.id === e.from);
            const b = cmNodes.find(n => n.id === e.to);
            if (!a || !b) return;
            let dx = (b.x + b.w / 2) - (a.x + a.w / 2);
            let dy = (b.y + b.h / 2) - (a.y + a.h / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);
            const force = (dist - 150) * 0.01;
            dx = dx / Math.max(dist, 1) * force;
            dy = dy / Math.max(dist, 1) * force;
            a.x += dx; a.y += dy;
            b.x -= dx; b.y -= dy;
          });
        }
        // Clamp to canvas
        cmNodes.forEach(n => {
          n.x = Math.max(pad, Math.min(cw - n.w - pad, n.x));
          n.y = Math.max(pad, Math.min(ch - n.h - pad, n.y));
        });
        break;
      }
      case 'grid': {
        const sorted = [...cmNodes].sort((a, b) => a.title.localeCompare(b.title));
        const cols = Math.ceil(Math.sqrt(sorted.length));
        const rows = Math.ceil(sorted.length / cols);
        const cellW = (cw - 2 * pad) / cols;
        const cellH = (ch - 2 * pad) / Math.max(rows, 1);
        sorted.forEach((n, i) => {
          const col = i % cols, row = Math.floor(i / cols);
          n.x = pad + col * cellW + cellW / 2 - n.w / 2;
          n.y = pad + row * cellH + cellH / 2 - n.h / 2;
        });
        break;
      }
      case 'timeline': {
        const sorted = [...cmNodes].sort((a, b) => a.id - b.id);
        const spacing = (cw - 2 * pad) / Math.max(sorted.length - 1, 1);
        sorted.forEach((n, i) => {
          n.x = pad + spacing * i - n.w / 2;
          n.y = ch / 2 - n.h / 2;
        });
        break;
      }
    }
    cmSave(); cmRender();
    toast('Layout: ' + input.layout);
    return JSON.stringify({ layout: input.layout, nodesRepositioned: cmNodes.length });
  }
};

// Self-register on window for inline dispatcher
window._toolDefinitions = toolDefinitions;
window._toolHandlers = toolHandlers;
