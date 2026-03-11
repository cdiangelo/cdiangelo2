"""
P&L Commentary Generator — Flask Backend
Reads P&L data from the Excel add-in and calls Claude API
to generate executive summary, variance analysis, and line-item commentary.
"""

import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
import anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)  # Allow requests from the Excel add-in (any origin during dev)

# Initialize Anthropic client
client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# Claude model to use
MODEL = "claude-sonnet-4-6"


# ============================================================
# Health check
# ============================================================
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL})


# ============================================================
# Main analysis endpoint
# ============================================================
@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON payload received."}), 400

    pl_data = data.get("pl_data")
    if not pl_data or len(pl_data) < 2:
        return jsonify({"error": "P&L data must have at least 2 rows."}), 400

    # Extract configuration
    company_name    = data.get("company_name", "the company")
    reporting_period = data.get("reporting_period", "the reporting period")
    currency        = data.get("currency", "USD")
    has_budget      = data.get("has_budget", False)
    has_prior_year  = data.get("has_prior_year", False)
    has_prior_period = data.get("has_prior_period", False)
    commentary_style = data.get("commentary_style", "formal")

    # Format the P&L table as structured text for Claude
    pl_text = format_pl_table(pl_data)

    # Build the prompt
    prompt = build_prompt(
        pl_text=pl_text,
        company_name=company_name,
        reporting_period=reporting_period,
        currency=currency,
        has_budget=has_budget,
        has_prior_year=has_prior_year,
        has_prior_period=has_prior_period,
        commentary_style=commentary_style,
    )

    try:
        message = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )

        raw_response = message.content[0].text
        commentary = parse_commentary(raw_response)
        return jsonify(commentary)

    except anthropic.AuthenticationError:
        return jsonify({"error": "Invalid Anthropic API key. Check your .env file."}), 401
    except anthropic.RateLimitError:
        return jsonify({"error": "Anthropic API rate limit reached. Please wait and try again."}), 429
    except anthropic.APIError as e:
        return jsonify({"error": f"Anthropic API error: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


# ============================================================
# P&L Table Formatter
# ============================================================
def format_pl_table(values: list) -> str:
    """Convert raw 2D cell values into a readable tabular text."""
    if not values:
        return ""

    # Determine column widths
    col_count = max(len(row) for row in values)
    col_widths = [0] * col_count

    for row in values:
        for i, cell in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(cell)) + 2)

    # Build text table
    lines = []
    for row_idx, row in enumerate(values):
        cells = []
        for i in range(col_count):
            cell = row[i] if i < len(row) else ""
            cell_str = format_cell(cell)
            cells.append(cell_str.ljust(col_widths[i]))
        lines.append(" | ".join(cells).rstrip())

        # Add separator after header row
        if row_idx == 0:
            lines.append("-" * sum(col_widths + [3 * (col_count - 1)]))

    return "\n".join(lines)


def format_cell(value) -> str:
    """Format a cell value for display."""
    if value is None or value == "":
        return ""
    if isinstance(value, float):
        if value == int(value):
            return f"{int(value):,}"
        return f"{value:,.1f}"
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


# ============================================================
# Prompt Builder
# ============================================================
def build_prompt(
    pl_text: str,
    company_name: str,
    reporting_period: str,
    currency: str,
    has_budget: bool,
    has_prior_year: bool,
    has_prior_period: bool,
    commentary_style: str,
) -> str:
    # Describe available comparison columns
    comparisons = []
    if has_budget:
        comparisons.append("Actual vs Budget")
    if has_prior_year:
        comparisons.append("Actual vs Prior Year")
    if has_prior_period:
        comparisons.append("Actual vs Prior Period")
    comparison_text = ", ".join(comparisons) if comparisons else "single period (no comparisons)"

    # Style instructions
    style_instructions = {
        "formal": (
            "Write in a formal, professional tone suitable for a Board of Directors or "
            "Senior Management report. Use full sentences and structured paragraphs."
        ),
        "concise": (
            "Write in a concise style using short paragraphs and bullet points where appropriate. "
            "Focus on the most significant items only."
        ),
        "detailed": (
            "Write in a detailed analytical style. Explain the drivers behind each movement, "
            "reference specific line items and percentages, and provide context for all variances."
        ),
    }.get(commentary_style, "Write in a formal, professional tone.")

    prompt = f"""You are an expert financial analyst and CFO-level commentator.
Your task is to analyze the following Profit & Loss statement and generate professional financial commentary.

CONTEXT:
- Company: {company_name}
- Reporting Period: {reporting_period}
- Currency: {currency}
- Available Comparisons: {comparison_text}
- Style: {style_instructions}

P&L STATEMENT:
{pl_text}

INSTRUCTIONS:
Analyze the P&L data above and generate three distinct sections of commentary.
Return your response in the following EXACT format using these section markers:

[EXECUTIVE_SUMMARY]
Write 2-3 paragraphs providing a high-level overview of financial performance.
Cover: overall revenue and profitability trends, key highlights, and headline variances.
{"Include commentary on actuals vs budget and/or prior year performance." if comparisons else ""}

[VARIANCE_ANALYSIS]
Provide a detailed explanation of the key variances.
For each significant variance:
- Name the line item
- State the actual value and comparison value (budget or prior year)
- Quantify the variance in both absolute and percentage terms if available
- Explain the likely business drivers or causes
Focus on variances that are material (either by size or strategic importance).

[LINE_ITEM_COMMENTARY]
Provide commentary on each major P&L category:
- Revenue / Net Sales
- Cost of Goods Sold / Gross Profit
- Operating Expenses (by category if available)
- EBITDA / Operating Income (if shown)
- Net Income / Net Profit
For each, briefly describe the performance and any notable items.

Important rules:
- Be specific — reference actual numbers from the data
- Use professional financial language
- If a value appears to be in thousands or millions, note that in your commentary
- Do not invent numbers not present in the data
- If comparison columns are not available, focus on absolute performance trends
"""

    return prompt


# ============================================================
# Response Parser
# ============================================================
def parse_commentary(raw: str) -> dict:
    """Extract the three commentary sections from Claude's response."""
    sections = {
        "executive_summary": "",
        "variance_analysis": "",
        "line_item_commentary": "",
    }

    markers = {
        "executive_summary": "[EXECUTIVE_SUMMARY]",
        "variance_analysis": "[VARIANCE_ANALYSIS]",
        "line_item_commentary": "[LINE_ITEM_COMMENTARY]",
    }

    marker_order = list(markers.keys())

    for i, key in enumerate(marker_order):
        start_marker = markers[key]
        start_idx = raw.find(start_marker)
        if start_idx == -1:
            continue

        content_start = start_idx + len(start_marker)

        # Find the next section marker to determine end
        end_idx = len(raw)
        for next_key in marker_order[i + 1:]:
            next_marker_idx = raw.find(markers[next_key])
            if next_marker_idx != -1 and next_marker_idx > content_start:
                end_idx = next_marker_idx
                break

        sections[key] = raw[content_start:end_idx].strip()

    # Fallback: if markers not found, return the full response as executive summary
    if not any(sections.values()):
        sections["executive_summary"] = raw.strip()
        sections["variance_analysis"] = "See executive summary above."
        sections["line_item_commentary"] = "See executive summary above."

    return sections


# ============================================================
# Run
# ============================================================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    print(f"\n P&L Commentary Backend running on http://localhost:{port}")
    print(f" Model: {MODEL}")
    print(f" Debug mode: {debug}\n")
    app.run(host="0.0.0.0", port=port, debug=debug)
