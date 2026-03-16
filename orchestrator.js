// ADDED — Phase 11: Orchestrator + Sub-Agent Architecture
// This ES module provides an orchestrator layer that decomposes complex requests
// into sub-tasks, runs them via focused sub-agents, intercepts errors, and
// escalates to the user with actionable options when stuck.
//
// GLOBAL DEP: executeAgentTool, addAiMsg, addToolStatus, saveToolAction,
//             setRobotWorking, getWorkspaceContext, saveInquiryLog,
//             aiSessionTokensIn, aiSessionTokensOut, aiSessionRequests,
//             updateCostPanel, trackUserUsage, toast, $, AGENT_TOOLS, MODEL_RATES

// ── Complexity Detection ──

export function isComplexRequest(input) {
  const signals = [
    input.split(/\band\b|\bthen\b|,/).length > 2,
    /compare.*and.*and/i.test(input),
    /\b(build|create|analyze|research)\b.*\b(also|plus|and)\b/i.test(input),
    input.length > 300,
    (input.match(/\b(sheet|note|graph|whiteboard|stock|concept|meme)\b/gi) || []).length > 2,
  ];
  return signals.filter(Boolean).length >= 2;
}

// ── Orchestrator Session ──

class OrchestratorSession {
  constructor(id, originalRequest) {
    this.id = id;
    this.originalRequest = originalRequest;
    this.plan = null;
    this.subAgentResults = new Map();
    this.escalations = [];
    this.state = 'planning';
    this.tokenUsage = { input: 0, output: 0, requests: 0 };
    this.startTime = Date.now();
  }

  trackTokens(inputTokens, outputTokens) {
    this.tokenUsage.input += inputTokens || 0;
    this.tokenUsage.output += outputTokens || 0;
    this.tokenUsage.requests++;
    // Also update global counters
    window.aiSessionTokensIn = (window.aiSessionTokensIn || 0) + (inputTokens || 0);
    window.aiSessionTokensOut = (window.aiSessionTokensOut || 0) + (outputTokens || 0);
    window.aiSessionRequests = (window.aiSessionRequests || 0) + 1;
  }
}

// ── Core API Call (shared helper) ──

async function apiCall(apiKey, model, systemPrompt, messages, tools, stream = false) {
  const body = {
    model: model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages,
  };
  if (tools && tools.length) body.tools = tools;
  if (stream) body.stream = true;

  // Use the shared proxy-aware fetch from workspace.html if available
  let resp;
  if (typeof window.aiApiFetch === 'function') {
    resp = await window.aiApiFetch(body);
  } else {
    // Fallback: direct API call
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
  }

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error('API ' + resp.status + ': ' + err.substring(0, 300));
  }

  if (stream) return resp;
  return await resp.json();
}

// ── Quick API Call (for planning & review — non-streaming, compact) ──

async function quickApiCall(apiKey, model, prompt) {
  const result = await apiCall(apiKey, model, prompt, [{ role: 'user', content: prompt }]);
  return result;
}

// ── Task Decomposition (Planning Call) ──

const PLANNER_SYSTEM = `You are a task planner for a workspace app with tools for: spreadsheet, notepad, graph, whiteboard, stock watchlist, news feed, concept map, memes, and analysis.

Decompose the user's request into independent sub-tasks. Each sub-task should be a focused unit of work.

Available tool categories:
- READ: get_sheet_range, get_note, get_graph_state, get_watchlist, get_stock_data, get_stock_fundamentals, get_news, get_concept_map, get_draw_pane_state, get_portfolio, get_orders, search_ticker
- WRITE: write_cells, clear_range, create_table, write_note, update_graph, add_stock, remove_stock, set_comparison, add_news_ticker, add_concept_node, write_to_draw_pane, add_text_overlay, clear_draw_pane, show_toast
- ANALYSIS: run_scenario, build_thesis, sentiment_summary, create_template, pricing_analysis
- WHITEBOARD: draw_shape, draw_chart_on_whiteboard, annotate_whiteboard, draw_summary_card, draw_table, apply_whiteboard_template
- WHITEBOARD_LAYOUT: get_draw_pane_state, align_layers, group_layers, ungroup_layers (use for organizing/reviewing whiteboard content)
- CONCEPT MAP: add_concept_edge, remove_concept_node, clear_concept_map, set_concept_map_layout
- RESEARCH: deep_research, build_thesis, sentiment_summary (for multi-source research, plan a CONSOLIDATION task at the end that reads all prior results and synthesizes them into a unified notepad page and summary table)
- IMAGE/MEME: search_image, create_meme

Return ONLY valid JSON (no markdown, no code fences):
{
  "tasks": [
    {
      "id": "task_1",
      "description": "Clear description of what to do",
      "tools_needed": ["tool_name1", "tool_name2"],
      "dependencies": [],
      "priority": 1
    }
  ]
}

Rules:
- Each task should target a specific workspace pane or action
- Mark dependencies: if task B needs data from task A, add "task_1" to B's dependencies
- Keep tasks focused — one concern per task
- Include read tools where the agent needs to check state before writing
- Priority 1 = highest priority
- CONSOLIDATION: For multi-step research (thesis + sentiment + scenarios + deep research), ALWAYS add a final consolidation task that depends on all research tasks. This task should: 1) read all notepad pages with get_note, 2) synthesize findings into a single structured report using write_note with target_page, 3) build a summary table in the sheet. Without this step, research fragments across separate pages.`;

async function decompose(session, workspaceContext, apiKey, model) {
  const prompt = '[Workspace State]\n' + workspaceContext + '\n\n[User Request]\n' + session.originalRequest;
  const result = await apiCall(apiKey, model, PLANNER_SYSTEM, [{ role: 'user', content: prompt }]);
  session.trackTokens(result.usage?.input_tokens, result.usage?.output_tokens);

  const text = (result.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    // Strip code fences if present
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const plan = JSON.parse(cleaned);
    if (!plan.tasks || !Array.isArray(plan.tasks)) throw new Error('No tasks array');
    return plan;
  } catch (e) {
    throw new Error('Planning failed: could not parse task plan. ' + e.message);
  }
}

// ── Topological Sort by Dependencies ──

function topologicalSort(tasks) {
  const sorted = [];
  const visited = new Set();
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  function visit(taskId) {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    const task = taskMap.get(taskId);
    if (!task) return;
    for (const dep of (task.dependencies || [])) {
      visit(dep);
    }
    sorted.push(task);
  }

  for (const task of tasks) visit(task.id);
  return sorted;
}

// ── Sub-Agent Execution ──

async function executeSubAgent(task, workspaceContext, apiKey, model, callbacks) {
  const subSystemPrompt = `You are a focused workspace agent. Your ONLY task:
${task.description}

Use ONLY these tools: ${task.tools_needed.join(', ')}
Do not attempt anything outside your assigned task.
Be concise. Execute the task and stop.`;

  const availableTools = (window.AGENT_TOOLS || []).filter(t => task.tools_needed.includes(t.name));
  const messages = [{ role: 'user', content: '[Current Workspace State]\n' + workspaceContext + '\n\n[Your Task]\n' + task.description }];

  const toolResults = [];
  const textOutput = [];
  let totalIn = 0, totalOut = 0;
  let iterations = 0;
  const MAX_SUB_ITERATIONS = 5;

  while (iterations < MAX_SUB_ITERATIONS) {
    iterations++;

    const result = await apiCall(apiKey, model, subSystemPrompt, messages, availableTools);
    totalIn += result.usage?.input_tokens || 0;
    totalOut += result.usage?.output_tokens || 0;

    const textBlocks = (result.content || []).filter(b => b.type === 'text');
    const toolBlocks = (result.content || []).filter(b => b.type === 'tool_use');

    if (textBlocks.length) {
      textOutput.push(textBlocks.map(b => b.text).join('\n'));
    }

    if (callbacks && callbacks.onStream && textBlocks.length) {
      callbacks.onStream(textBlocks.map(b => b.text).join('\n'));
    }

    if (result.stop_reason !== 'tool_use' || !toolBlocks.length) break;

    // Execute tools
    const results = [];
    for (const toolBlock of toolBlocks) {
      if (callbacks && callbacks.onToolUse) callbacks.onToolUse(toolBlock.name, toolBlock.input);
      const toolResult = await window.executeAgentTool(toolBlock.name, toolBlock.input);
      results.push({ type: 'tool_result', tool_use_id: toolBlock.id, content: toolResult });
      toolResults.push({ tool: toolBlock.name, input: toolBlock.input, result: toolResult });
    }

    messages.push({ role: 'assistant', content: result.content });
    messages.push({ role: 'user', content: results });
  }

  return {
    text: textOutput.join('\n'),
    toolResults: toolResults,
    toolsUsed: [...new Set(toolResults.map(r => r.tool))],
    errors: toolResults.filter(r => {
      try { return JSON.parse(r.result).error; } catch { return false; }
    }).map(r => ({ tool: r.tool, error: JSON.parse(r.result).error })),
    summary: textOutput.join('\n').substring(0, 500),
    tokenUsage: { input: totalIn, output: totalOut }
  };
}

// ── Tier 1: Automated Error Checks ──

function tier1Check(task, result) {
  const errors = [];

  // Check for tool-level errors
  for (const r of result.toolResults) {
    try {
      const parsed = JSON.parse(r.result);
      if (parsed.error) errors.push({ tool: r.tool, error: parsed.error });
    } catch { /* non-JSON result is fine */ }
  }

  // Did the sub-agent use any tools at all?
  if (result.toolResults.length === 0) {
    errors.push({ type: 'no_action', error: 'Sub-agent produced no tool calls for: ' + task.description });
  }

  return { pass: errors.length === 0, errors };
}

// ── Tier 2: Semantic Review ──

const REVIEWER_SYSTEM = `You are a quality reviewer. Evaluate whether a sub-agent correctly completed its assigned task. Return ONLY valid JSON (no markdown, no code fences):
{
  "pass": true/false,
  "issues": ["issue description"],
  "fixable": true/false,
  "fix_instructions": "specific correction instructions",
  "suggested_alternatives": ["alternative approach 1"]
}`;

async function tier2Review(task, result, apiKey, model) {
  const prompt = `Task: "${task.description}"
Sub-agent output: ${result.summary}
Tools used: ${result.toolsUsed.join(', ') || 'none'}
Tool errors: ${result.errors.map(e => e.tool + ': ' + e.error).join('; ') || 'none'}
Tool results count: ${result.toolResults.length}

Did the sub-agent correctly complete the task?`;

  // Use a lighter model for review to save cost
  const reviewModel = 'claude-haiku-4-5-20251001';
  try {
    const reviewResult = await apiCall(apiKey, reviewModel, REVIEWER_SYSTEM, [{ role: 'user', content: prompt }]);
    const text = (reviewResult.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // If review fails, assume pass (don't block on review failures)
    return { pass: true, issues: [], fixable: false, fix_instructions: '', suggested_alternatives: [] };
  }
}

// ── Intercept & Retry (Try Twice, Then Ask) ──

async function interceptAndRetry(task, result, workspaceContext, apiKey, model, callbacks, retryCount) {
  if (retryCount === undefined) retryCount = 0;
  const MAX_AUTO_RETRIES = 2;

  // Tier 1: Automated checks
  const t1 = tier1Check(task, result);
  if (t1.pass) {
    // Tier 2: Semantic review
    const t2 = await tier2Review(task, result, apiKey, model);
    if (t2.pass) return { action: 'accept', result: result };
    if (!t2.fixable) return { action: 'escalate', issues: t2.issues, tried: retryCount, alternatives: t2.suggested_alternatives || [] };

    // Fixable — retry with corrective instructions
    if (retryCount < MAX_AUTO_RETRIES) {
      if (callbacks && callbacks.onRetry) callbacks.onRetry(task, retryCount + 1, t2.fix_instructions);
      const retryTask = Object.assign({}, task, {
        description: task.description + '\n\nCORRECTION: ' + t2.fix_instructions
      });
      const retryResult = await executeSubAgent(retryTask, workspaceContext, apiKey, model, callbacks);
      return interceptAndRetry(task, retryResult, workspaceContext, apiKey, model, callbacks, retryCount + 1);
    }
    return { action: 'escalate', issues: t2.issues, tried: retryCount, alternatives: t2.suggested_alternatives || [] };
  }

  // Tier 1 failed — auto-retry with error context
  if (retryCount < MAX_AUTO_RETRIES) {
    if (callbacks && callbacks.onRetry) callbacks.onRetry(task, retryCount + 1, t1.errors.map(e => e.error).join('; '));
    const retryTask = Object.assign({}, task, {
      description: task.description + '\n\nPREVIOUS ERRORS (fix these): ' + t1.errors.map(e => e.error).join('; ')
    });
    const retryResult = await executeSubAgent(retryTask, workspaceContext, apiKey, model, callbacks);
    return interceptAndRetry(task, retryResult, workspaceContext, apiKey, model, callbacks, retryCount + 1);
  }

  return { action: 'escalate', issues: t1.errors.map(e => e.error), tried: retryCount, alternatives: [] };
}

// ── Escalation UI ──

function renderEscalationCard(task, issues, tried, alternatives) {
  return new Promise(function(resolve) {
    const card = document.createElement('div');
    card.className = 'ai-msg system escalation-card';
    card.style.cssText = 'background:rgba(255,152,0,.08);border:1px solid rgba(255,152,0,.3);border-radius:8px;padding:12px 14px;margin:6px 0;font-size:.65rem;';

    const header = document.createElement('div');
    header.style.cssText = 'font-weight:700;color:#FF9800;margin-bottom:8px;font-size:.7rem;';
    header.textContent = '\u26A0 Need your input';
    card.appendChild(header);

    const context = document.createElement('div');
    context.style.cssText = 'margin-bottom:8px;color:var(--text);line-height:1.5;';
    context.innerHTML = 'I was trying to <strong>' + escHtml(task.description) + '</strong> but hit an issue:<br><em>' + escHtml(issues.join('; ')) + '</em>';
    card.appendChild(context);

    if (tried > 0) {
      const triedDiv = document.createElement('div');
      triedDiv.style.cssText = 'margin-bottom:10px;color:var(--text-dim);font-size:.6rem;';
      triedDiv.textContent = 'Attempted ' + tried + ' automatic ' + (tried === 1 ? 'retry' : 'retries') + ' before escalating.';
      card.appendChild(triedDiv);
    }

    const optionsDiv = document.createElement('div');
    optionsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;';

    const options = [
      { label: 'Skip this step', value: 'skip' },
    ];
    if (alternatives.length > 0) {
      options.push({ label: 'Try: ' + alternatives[0].substring(0, 40), value: 'alternative', detail: alternatives[0] });
    }
    options.push({ label: 'Retry with single agent', value: 'single_agent' });
    options.push({ label: 'Let me explain...', value: 'custom' });

    options.forEach(function(opt) {
      const btn = document.createElement('button');
      btn.style.cssText = 'padding:4px 10px;border:1px solid var(--accent);border-radius:4px;background:none;color:var(--accent);cursor:pointer;font-size:.6rem;font-weight:600;';
      btn.textContent = opt.label;
      btn.onmouseenter = function() { btn.style.background = 'var(--accent)'; btn.style.color = '#fff'; };
      btn.onmouseleave = function() { btn.style.background = 'none'; btn.style.color = 'var(--accent)'; };
      btn.onclick = function() {
        if (opt.value === 'custom') {
          customDiv.style.display = 'flex';
          customInput.focus();
        } else {
          disableCard();
          resolve({ choice: opt.value, detail: opt.detail || '' });
        }
      };
      optionsDiv.appendChild(btn);
    });
    card.appendChild(optionsDiv);

    const customDiv = document.createElement('div');
    customDiv.style.cssText = 'display:none;gap:6px;align-items:center;';
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Tell me more...';
    customInput.style.cssText = 'flex:1;padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:.6rem;background:var(--panel-inset);color:var(--text);';
    const customSubmit = document.createElement('button');
    customSubmit.textContent = 'Send';
    customSubmit.style.cssText = 'padding:4px 10px;border:1px solid var(--accent);border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;font-size:.6rem;font-weight:600;';
    customSubmit.onclick = function() {
      disableCard();
      resolve({ choice: 'custom', detail: customInput.value.trim() });
    };
    customInput.onkeydown = function(e) { if (e.key === 'Enter') customSubmit.click(); };
    customDiv.appendChild(customInput);
    customDiv.appendChild(customSubmit);
    card.appendChild(customDiv);

    function disableCard() {
      card.style.opacity = '0.6';
      card.style.pointerEvents = 'none';
    }

    // 5-minute timeout — auto-skip
    const timeout = setTimeout(function() {
      disableCard();
      const timeoutMsg = document.createElement('div');
      timeoutMsg.style.cssText = 'font-size:.55rem;color:var(--text-dim);margin-top:4px;';
      timeoutMsg.textContent = '(Auto-skipped after 5 minute timeout)';
      card.appendChild(timeoutMsg);
      resolve({ choice: 'skip', detail: 'auto-timeout' });
    }, 300000);

    // Clean up timeout if resolved by user action
    var origResolve = resolve;
    resolve = function(val) {
      clearTimeout(timeout);
      origResolve(val);
    };

    const msgsEl = document.getElementById('aiMsgs') || document.querySelector('#aiMsgs');
    if (msgsEl) {
      msgsEl.appendChild(card);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Orchestrator Status Display ──

function createStatusPanel() {
  const panel = document.createElement('div');
  panel.id = 'orchestratorStatus';
  panel.style.cssText = 'background:var(--panel-inset);border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin:4px 0;font-size:.6rem;';
  const header = document.createElement('div');
  header.style.cssText = 'font-weight:700;color:var(--accent2);margin-bottom:4px;font-size:.62rem;';
  header.textContent = '\u2699 Orchestrator Active';
  panel.appendChild(header);
  const taskList = document.createElement('div');
  taskList.id = 'orchTaskList';
  panel.appendChild(taskList);
  return panel;
}

function updateStatusPanel(tasks, results) {
  const taskList = document.getElementById('orchTaskList');
  if (!taskList) return;
  taskList.innerHTML = '';
  tasks.forEach(function(task) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:2px 0;color:var(--text);display:flex;align-items:center;gap:6px;';
    const state = results.get(task.id);
    var icon, color;
    if (!state) { icon = '\u23F3'; color = 'var(--text-dim)'; }
    else if (state.status === 'running') { icon = '\u25B6'; color = 'var(--accent)'; }
    else if (state.status === 'complete') { icon = '\u2713'; color = '#4CAF50'; }
    else if (state.status === 'failed') { icon = '\u2717'; color = 'var(--danger)'; }
    else if (state.status === 'skipped') { icon = '\u23ED'; color = 'var(--text-dim)'; }
    else { icon = '\u23F3'; color = 'var(--text-dim)'; }
    row.innerHTML = '<span style="color:' + color + ';font-weight:700;">' + icon + '</span> ' + escHtml(task.description.substring(0, 80));
    taskList.appendChild(row);
  });
}

// ── Orchestrator Logging ──

function saveOrchestratorLog(session) {
  try {
    const key = 'orchestrator_log_' + session.id;
    const log = {
      id: session.id,
      timestamp: new Date().toISOString(),
      originalRequest: session.originalRequest,
      plan: session.plan,
      results: Array.from(session.subAgentResults.entries()).map(function(e) {
        return { taskId: e[0], status: e[1].status, errors: e[1].errors || [] };
      }),
      escalations: session.escalations,
      tokenUsage: session.tokenUsage,
      duration: Date.now() - session.startTime,
      state: session.state
    };
    localStorage.setItem(key, JSON.stringify(log));

    // Keep only last 20 orchestrator logs
    const allKeys = [];
    for (var i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('orchestrator_log_')) allKeys.push(k);
    }
    if (allKeys.length > 20) {
      allKeys.sort();
      for (var j = 0; j < allKeys.length - 20; j++) {
        localStorage.removeItem(allKeys[j]);
      }
    }
  } catch (e) { console.warn('Failed to save orchestrator log:', e); }
}

// ── Main Entry Point ──

export async function runOrchestrated(userInput, workspaceContext, config) {
  const apiKey = config.aiKey;
  const model = config.model;
  const session = new OrchestratorSession(Date.now().toString(36) + Math.random().toString(36).slice(2, 6), userInput);

  const addMsg = window.addAiMsg || function(role, text) {
    const div = document.createElement('div');
    div.className = 'ai-msg ' + role;
    div.textContent = text;
    const el = document.getElementById('aiMsgs');
    if (el) { el.appendChild(div); el.scrollTop = el.scrollHeight; }
    return div;
  };

  const thinkingDiv = addMsg('system', 'Orchestrator: Analyzing request...');
  if (window.setRobotWorking) window.setRobotWorking(true);
  window.aiStreaming = true;

  // Outer watchdog — 180s total for entire orchestration
  let aborted = false;
  const outerTimeout = setTimeout(function() {
    aborted = true;
    addMsg('system', '\u26D4 Orchestrator timed out after 3 minutes. Partial results may have been written to the workspace.');
    window.aiStreaming = false;
    if (window.setRobotWorking) window.setRobotWorking(false);
    session.state = 'failed';
    saveOrchestratorLog(session);
  }, 180000);

  try {
    // Step 1: Decompose
    session.state = 'planning';
    thinkingDiv.textContent = 'Orchestrator: Decomposing into sub-tasks...';
    let plan;
    try {
      plan = await decompose(session, workspaceContext, apiKey, model);
    } catch (e) {
      // Planning failed — fall back to single-agent mode
      clearTimeout(outerTimeout);
      thinkingDiv.textContent = 'Orchestrator: Planning failed, using single agent. (' + e.message + ')';
      window.aiStreaming = false;
      if (window.setRobotWorking) window.setRobotWorking(false);
      // Fall back to normal sendAgentMessage
      if (window._sendAgentMessageDirect) {
        return window._sendAgentMessageDirect(userInput);
      }
      return;
    }

    session.plan = plan;
    const tasks = topologicalSort(plan.tasks);

    // Step 2: Show status panel
    thinkingDiv.remove();
    const statusPanel = createStatusPanel();
    const msgsEl = document.getElementById('aiMsgs');
    if (msgsEl) { msgsEl.appendChild(statusPanel); msgsEl.scrollTop = msgsEl.scrollHeight; }

    // Initialize results map
    tasks.forEach(function(t) { session.subAgentResults.set(t.id, { status: 'pending' }); });
    updateStatusPanel(tasks, session.subAgentResults);

    addMsg('assistant', 'I\'ve broken this into ' + tasks.length + ' sub-tasks. Working on them now...');

    // Step 3: Execute sub-agents (respecting dependencies)
    session.state = 'executing';
    const completedTasks = new Set();

    for (var i = 0; i < tasks.length; i++) {
      if (aborted) break;
      const task = tasks[i];

      // Check dependencies
      const depsOk = (task.dependencies || []).every(function(dep) { return completedTasks.has(dep); });
      if (!depsOk) {
        // Check if dependencies failed
        const depsFailed = (task.dependencies || []).some(function(dep) {
          const depResult = session.subAgentResults.get(dep);
          return depResult && (depResult.status === 'failed' || depResult.status === 'skipped');
        });
        if (depsFailed) {
          session.subAgentResults.set(task.id, { status: 'skipped', errors: ['Dependency failed'] });
          updateStatusPanel(tasks, session.subAgentResults);
          continue;
        }
      }

      // Mark running
      session.subAgentResults.set(task.id, { status: 'running' });
      updateStatusPanel(tasks, session.subAgentResults);

      // Fresh workspace context for each sub-agent (captures changes from previous agents)
      const freshContext = window.getWorkspaceContext ? window.getWorkspaceContext() : workspaceContext;

      const callbacks = {
        onToolUse: function(name, input) {
          if (window.addToolStatus) window.addToolStatus(name, input);
          if (window.saveToolAction) window.saveToolAction(name, input);
        },
        onRetry: function(retryTask, attempt, reason) {
          addMsg('system', '\u21BB Retry ' + attempt + '/2 for "' + retryTask.description.substring(0, 50) + '": ' + reason.substring(0, 100));
        }
      };

      try {
        const result = await executeSubAgent(task, freshContext, apiKey, model, callbacks);
        session.trackTokens(result.tokenUsage.input, result.tokenUsage.output);

        // Track usage per model
        if (window.trackUserUsage) window.trackUserUsage(result.tokenUsage.input, result.tokenUsage.output, model);
        if (window.updateCostPanel) {
          const costPanel = document.getElementById('aiCostPanel');
          if (costPanel && costPanel.style.display !== 'none') window.updateCostPanel();
        }

        // Intercept & evaluate
        session.state = 'reviewing';
        const verdict = await interceptAndRetry(task, result, freshContext, apiKey, model, callbacks, 0);

        if (verdict.action === 'accept') {
          session.subAgentResults.set(task.id, { status: 'complete', result: verdict.result });
          completedTasks.add(task.id);
        } else if (verdict.action === 'escalate') {
          // Escalate to user
          session.state = 'escalating';
          session.escalations.push({ taskId: task.id, issues: verdict.issues, tried: verdict.tried });
          const userResponse = await renderEscalationCard(task, verdict.issues, verdict.tried, verdict.alternatives || []);

          if (userResponse.choice === 'skip') {
            session.subAgentResults.set(task.id, { status: 'skipped', errors: verdict.issues });
          } else if (userResponse.choice === 'alternative' && userResponse.detail) {
            // Retry with alternative approach
            const altTask = Object.assign({}, task, { description: userResponse.detail });
            const altResult = await executeSubAgent(altTask, freshContext, apiKey, model, callbacks);
            session.trackTokens(altResult.tokenUsage.input, altResult.tokenUsage.output);
            session.subAgentResults.set(task.id, { status: 'complete', result: altResult });
            completedTasks.add(task.id);
          } else if (userResponse.choice === 'single_agent') {
            // Fall back to single agent for this task
            session.subAgentResults.set(task.id, { status: 'skipped', errors: ['User chose single-agent fallback'] });
          } else if (userResponse.choice === 'custom' && userResponse.detail) {
            // Retry with user's custom instructions
            const customTask = Object.assign({}, task, {
              description: task.description + '\n\nUSER CLARIFICATION: ' + userResponse.detail
            });
            const customResult = await executeSubAgent(customTask, freshContext, apiKey, model, callbacks);
            session.trackTokens(customResult.tokenUsage.input, customResult.tokenUsage.output);
            session.subAgentResults.set(task.id, { status: 'complete', result: customResult });
            completedTasks.add(task.id);
          }
          session.state = 'executing';
        }
      } catch (e) {
        session.subAgentResults.set(task.id, { status: 'failed', errors: [e.message] });
      }

      updateStatusPanel(tasks, session.subAgentResults);
    }

    // Step 4: Final summary
    clearTimeout(outerTimeout);
    session.state = 'complete';

    const completed = Array.from(session.subAgentResults.values()).filter(function(r) { return r.status === 'complete'; }).length;
    const failed = Array.from(session.subAgentResults.values()).filter(function(r) { return r.status === 'failed'; }).length;
    const skipped = Array.from(session.subAgentResults.values()).filter(function(r) { return r.status === 'skipped'; }).length;

    let summary = 'Orchestrator complete: ' + completed + '/' + tasks.length + ' tasks done';
    if (failed > 0) summary += ', ' + failed + ' failed';
    if (skipped > 0) summary += ', ' + skipped + ' skipped';

    const costEst = (session.tokenUsage.input / 1e6 * ((window.MODEL_RATES && window.MODEL_RATES[model]) || { input: 3 }).input) +
                    (session.tokenUsage.output / 1e6 * ((window.MODEL_RATES && window.MODEL_RATES[model]) || { output: 15 }).output);
    summary += ' (~$' + costEst.toFixed(4) + ')';

    addMsg('system', summary);

    // Save log
    saveOrchestratorLog(session);

    // If user chose single-agent fallback for any task, offer to run full request
    if (Array.from(session.subAgentResults.values()).some(function(r) { return r.errors && r.errors.includes('User chose single-agent fallback'); })) {
      addMsg('system', 'Tip: Some tasks were deferred to single-agent mode. Type your request again with the orchestrator toggle off to run it directly.');
    }

  } catch (e) {
    clearTimeout(outerTimeout);
    addMsg('system', '\u26D4 Orchestrator error: ' + e.message);
    session.state = 'failed';
    saveOrchestratorLog(session);
  }

  window.aiStreaming = false;
  if (window.setRobotWorking) window.setRobotWorking(false);
}

// Self-register on window
window._runOrchestrated = runOrchestrated;
window._isComplexRequest = isComplexRequest;
