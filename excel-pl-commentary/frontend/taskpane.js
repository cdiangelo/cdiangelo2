/* ============================================================
   P&L Commentary Generator — Task Pane JavaScript
   Office.js + Claude API integration
   ============================================================ */

// Backend URL — update this to your deployed Flask server URL
const BACKEND_URL = "http://localhost:5000";

// State
let capturedData = null;
let currentTab = "exec";
let generatedCommentary = null;

// ============================================================
// Office.js Initialization
// ============================================================
Office.onReady((info) => {
  if (info.host === Office.HostType.Excel) {
    console.log("P&L Commentary Add-in loaded.");
  }
});

// ============================================================
// Step 2: Capture Selected Range
// ============================================================
async function captureSelection() {
  const btn = document.getElementById("btn-capture");
  btn.disabled = true;
  btn.querySelector(".ms-Button-label").textContent = "Capturing...";

  try {
    await Excel.run(async (context) => {
      const range = context.workbook.getSelectedRange();
      range.load(["address", "values", "rowCount", "columnCount"]);
      await context.sync();

      const values = range.values;
      const rowCount = range.rowCount;
      const colCount = range.columnCount;

      if (rowCount < 2 || colCount < 2) {
        showError("Please select a range with at least 2 rows and 2 columns.");
        return;
      }

      capturedData = {
        address: range.address,
        values: values,
        rowCount: rowCount,
        columnCount: colCount,
      };

      // Show preview
      document.getElementById("range-address").textContent = range.address;
      document.getElementById("range-summary").textContent =
        `${rowCount} rows × ${colCount} columns — ${countNonEmptyRows(values)} data rows detected`;
      document.getElementById("range-preview").classList.remove("hidden");

      // Enable generate button
      document.getElementById("btn-generate").disabled = false;
      hideError();
    });
  } catch (err) {
    showError("Could not read selection: " + err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector(".ms-Button-label").textContent = "✆ Capture Selected Range";
  }
}

function countNonEmptyRows(values) {
  return values.filter(row => row.some(cell => cell !== "" && cell !== null)).length;
}

// ============================================================
// Step 3: Generate Commentary
// ============================================================
async function generateCommentary() {
  if (!capturedData) {
    showError("Please capture your P&L range first.");
    return;
  }

  const config = getConfig();
  const btn = document.getElementById("btn-generate");
  btn.disabled = true;
  showLoading(true);
  hideError();

  try {
    const payload = {
      pl_data: capturedData.values,
      company_name: config.companyName,
      reporting_period: config.reportingPeriod,
      currency: config.currency,
      has_budget: config.hasBudget,
      has_prior_year: config.hasPriorYear,
      has_prior_period: config.hasPriorPeriod,
      commentary_style: config.commentaryStyle,
    };

    const response = await fetch(`${BACKEND_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Server error: ${response.status}`);
    }

    const data = await response.json();
    generatedCommentary = data;

    renderResults(data);
    document.getElementById("section-results").classList.remove("hidden");
    document.getElementById("section-results").scrollIntoView({ behavior: "smooth" });

  } catch (err) {
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      showError(
        "Cannot reach the backend server.\n\n" +
        "Make sure the Flask server is running:\n" +
        "  cd backend && python app.py\n\n" +
        "Then update BACKEND_URL in taskpane.js if needed."
      );
    } else {
      showError("Error generating commentary: " + err.message);
    }
  } finally {
    btn.disabled = false;
    showLoading(false);
  }
}

// ============================================================
// Render Commentary Results
// ============================================================
function renderResults(data) {
  document.getElementById("content-exec").textContent =
    data.executive_summary || "No executive summary generated.";
  document.getElementById("content-variance").textContent =
    data.variance_analysis || "No variance analysis generated.";
  document.getElementById("content-lineitems").textContent =
    data.line_item_commentary || "No line-item commentary generated.";
}

// ============================================================
// Tab Switching
// ============================================================
function switchTab(tabName) {
  currentTab = tabName;

  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));

  document.getElementById(`tab-${tabName}`).classList.add("active");
  document.getElementById(`panel-${tabName}`).classList.remove("hidden");
}

// ============================================================
// Insert Commentary into Workbook
// ============================================================
async function insertToSheet(mode) {
  if (!generatedCommentary) return;

  try {
    await Excel.run(async (context) => {
      const workbook = context.workbook;

      if (mode === "all") {
        // Create a new sheet named "P&L Commentary"
        let sheetName = "PL Commentary";
        try {
          workbook.worksheets.getItem(sheetName).delete();
          await context.sync();
        } catch (e) { /* sheet didn't exist, that's fine */ }

        const sheet = workbook.worksheets.add(sheetName);
        sheet.activate();

        const rows = buildCommentaryRows(generatedCommentary);
        const range = sheet.getRangeByIndexes(0, 0, rows.length, 1);
        range.values = rows.map(r => [r]);

        // Style the headers
        styleCommentarySheet(sheet, rows);

        await context.sync();
        showSuccess("Commentary inserted into 'PL Commentary' sheet.");

      } else if (mode === "active") {
        // Insert active tab content below the P&L data
        const sheet = workbook.worksheets.getActiveWorksheet();
        const tabContent = getActiveTabContent();
        const insertRow = capturedData ? capturedData.values.length + 3 : 2;

        const lines = tabContent.split("\n");
        const range = sheet.getRangeByIndexes(insertRow, 0, lines.length, 1);
        range.values = lines.map(l => [l]);

        await context.sync();
        showSuccess(`Commentary inserted at row ${insertRow + 1}.`);
      }
    });
  } catch (err) {
    showError("Could not insert commentary: " + err.message);
  }
}

function buildCommentaryRows(data) {
  const rows = [];
  const period = document.getElementById("reportingPeriod").value || "Reporting Period";
  const company = document.getElementById("companyName").value || "Company";

  rows.push(`P&L COMMENTARY — ${company} — ${period}`);
  rows.push("");
  rows.push("EXECUTIVE SUMMARY");
  rows.push("─────────────────────────────────────");
  data.executive_summary.split("\n").forEach(l => rows.push(l));
  rows.push("");
  rows.push("VARIANCE ANALYSIS");
  rows.push("─────────────────────────────────────");
  data.variance_analysis.split("\n").forEach(l => rows.push(l));
  rows.push("");
  rows.push("LINE-ITEM COMMENTARY");
  rows.push("─────────────────────────────────────");
  data.line_item_commentary.split("\n").forEach(l => rows.push(l));

  return rows;
}

function styleCommentarySheet(sheet, rows) {
  // Bold + blue the section headers
  const headerIndices = [0, 2, 6];
  headerIndices.forEach(i => {
    if (i < rows.length) {
      const cell = sheet.getRangeByIndexes(i, 0, 1, 1);
      cell.format.font.bold = true;
      cell.format.font.color = "#0078d4";
      cell.format.font.size = i === 0 ? 14 : 11;
    }
  });

  // Auto-fit column width
  const col = sheet.getRangeByIndexes(0, 0, rows.length, 1);
  col.format.columnWidth = 600;
  col.format.wrapText = true;
  col.format.verticalAlignment = "Top";
}

function getActiveTabContent() {
  if (!generatedCommentary) return "";
  const map = {
    exec: generatedCommentary.executive_summary,
    variance: generatedCommentary.variance_analysis,
    lineitems: generatedCommentary.line_item_commentary,
  };
  return map[currentTab] || "";
}

// ============================================================
// Copy to Clipboard
// ============================================================
async function copyToClipboard() {
  if (!generatedCommentary) return;

  const all = [
    "EXECUTIVE SUMMARY\n" + generatedCommentary.executive_summary,
    "\nVARIANCE ANALYSIS\n" + generatedCommentary.variance_analysis,
    "\nLINE-ITEM COMMENTARY\n" + generatedCommentary.line_item_commentary,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(all);
    showSuccess("Copied to clipboard.");
  } catch (e) {
    showError("Could not copy to clipboard. Try selecting and copying manually.");
  }
}

// ============================================================
// Clear Results
// ============================================================
function clearResults() {
  generatedCommentary = null;
  document.getElementById("section-results").classList.add("hidden");
  document.getElementById("content-exec").textContent = "";
  document.getElementById("content-variance").textContent = "";
  document.getElementById("content-lineitems").textContent = "";
}

// ============================================================
// Helpers
// ============================================================
function getConfig() {
  return {
    companyName: document.getElementById("companyName").value.trim(),
    reportingPeriod: document.getElementById("reportingPeriod").value.trim(),
    currency: document.getElementById("currency").value,
    hasBudget: document.getElementById("hasBudget").checked,
    hasPriorYear: document.getElementById("hasPriorYear").checked,
    hasPriorPeriod: document.getElementById("hasPriorPeriod").checked,
    commentaryStyle: document.getElementById("commentaryStyle").value,
  };
}

function showLoading(show) {
  document.getElementById("loading").classList.toggle("hidden", !show);
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError() {
  document.getElementById("error-msg").classList.add("hidden");
}

function showSuccess(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = "✔ " + msg;
  el.style.background = "#dff6dd";
  el.style.borderColor = "#107c10";
  el.style.color = "#107c10";
  el.classList.remove("hidden");
  setTimeout(() => {
    el.classList.add("hidden");
    el.style.background = "";
    el.style.borderColor = "";
    el.style.color = "";
  }, 4000);
}
