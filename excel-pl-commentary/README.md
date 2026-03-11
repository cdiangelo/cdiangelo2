# P&L Commentary Generator — Excel Add-in

An AI-powered Excel Online add-in that reads your Profit & Loss statement and generates professional financial commentary using Claude (Anthropic).

## What It Generates

| Section | Description |
|---|---|
| **Executive Summary** | 2–3 paragraph high-level overview of financial performance |
| **Variance Analysis** | Explanation of key variances (Actual vs Budget, vs Prior Year) |
| **Line-Item Commentary** | Narrative for Revenue, COGS, Gross Profit, OpEx, Net Income |

---

## Project Structure

```
excel-pl-commentary/
├── manifest.xml              ← Office Add-in manifest (register this in Excel)
├── frontend/
│   ├── taskpane.html         ← Add-in UI (task pane)
│   ├── taskpane.js           ← Office.js logic + API calls
│   └── taskpane.css          ← Styling (Fluent UI)
└── backend/
    ├── app.py                ← Flask API server (calls Claude)
    ├── requirements.txt      ← Python dependencies
    └── .env.example          ← Environment variable template
```

---

## Setup Instructions

### Step 1 — Get an Anthropic API Key

1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Create an account and generate an API key
3. Copy the key (starts with `sk-ant-...`)

---

### Step 2 — Set Up the Backend (Python Flask)

**Requirements:** Python 3.9+

```bash
# Navigate to the backend folder
cd excel-pl-commentary/backend

# Install dependencies
pip install -r requirements.txt

# Create your .env file from the template
cp .env.example .env

# Open .env and add your API key:
#   ANTHROPIC_API_KEY=sk-ant-your-key-here

# Start the Flask server
python app.py
```

You should see:
```
P&L Commentary Backend running on http://localhost:5000
Model: claude-sonnet-4-6
```

Leave this terminal running while using the add-in.

---

### Step 3 — Serve the Frontend

The add-in frontend must be served over HTTPS for Excel Online.

**Option A: Local development with a simple HTTPS server**

```bash
# Install a simple local HTTPS server (Node.js required)
npm install -g local-ssl-proxy http-server

# In the project root, serve the frontend
cd excel-pl-commentary
http-server -p 3001

# In another terminal, proxy with HTTPS
local-ssl-proxy --source 3000 --target 3001
```

**Option B: Deploy to GitHub Pages (free, recommended)**

1. Push this repo to GitHub
2. Go to Settings → Pages → Source: Deploy from branch
3. Update `manifest.xml` and `taskpane.js` to use your GitHub Pages URL
   - Replace `https://localhost:3000` with `https://yourusername.github.io/yourrepo`

**Option C: Deploy backend to a cloud service**

For production use, deploy the Flask backend to:
- [Railway](https://railway.app) (free tier available)
- [Render](https://render.com)
- [Azure App Service](https://azure.microsoft.com/en-us/products/app-service)

Then update `BACKEND_URL` in `frontend/taskpane.js` to your deployed URL.

---

### Step 4 — Load the Add-in in Excel Online

1. Open **Excel Online** at [office.com](https://office.com)
2. Open any workbook
3. Go to **Insert → Add-ins → Upload My Add-in**
4. Select the `manifest.xml` file from this project
5. The **"Generate Commentary"** button will appear in the **Home** ribbon tab

> **Note:** Excel Online requires the add-in frontend to be served over HTTPS.
> During local development, you must use `https://localhost:3000` with a valid SSL certificate.

---

## How to Use

1. **Open your P&L spreadsheet** in Excel Online
2. Click **"Generate Commentary"** in the Home ribbon
3. Fill in the configuration panel:
   - Company name
   - Reporting period (e.g., "Q1 2025")
   - Currency
   - Which comparison columns are present (Budget, Prior Year, etc.)
   - Commentary style (Formal / Concise / Detailed)
4. **Select your P&L range** in the sheet (include headers)
5. Click **"Capture Selected Range"**
6. Click **"Generate AI Commentary"**
7. View results across three tabs: Executive Summary, Variance Analysis, Line Items
8. Click **"Insert All to New Sheet"** to write commentary directly into your workbook

---

## P&L Format Tips

The add-in works best when your P&L is structured like this:

| Line Item | Actual | Budget | Variance | Var % | Prior Year |
|---|---|---|---|---|---|
| Revenue | 1,200,000 | 1,100,000 | 100,000 | 9.1% | 950,000 |
| Cost of Goods Sold | (720,000) | (660,000) | (60,000) | -9.1% | (570,000) |
| **Gross Profit** | **480,000** | **440,000** | **40,000** | **9.1%** | **380,000** |
| Operating Expenses | (200,000) | (180,000) | (20,000) | -11.1% | (160,000) |
| **Net Income** | **280,000** | **260,000** | **20,000** | **7.7%** | **220,000** |

- First row should be column headers
- First column should be line item labels
- Numbers can be formatted (commas, parentheses for negatives) — Claude will interpret them

---

## Configuration

### Backend URL
If your Flask server runs on a different port or host, update this line in `frontend/taskpane.js`:

```javascript
const BACKEND_URL = "http://localhost:5000";
```

### Changing the Claude Model
In `backend/app.py`, change:
```python
MODEL = "claude-sonnet-4-6"
```
Available models: `claude-opus-4-6` (most capable), `claude-sonnet-4-6` (balanced), `claude-haiku-4-5-20251001` (fastest/cheapest)

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Cannot reach backend server" | Make sure `python app.py` is running in the backend folder |
| "Invalid API key" | Check your `.env` file has the correct `ANTHROPIC_API_KEY` |
| Add-in doesn't load in Excel | Ensure frontend is served over HTTPS on port 3000 |
| Commentary sections are empty | Make sure your selected range has at least 2 rows and 2 columns |
| Numbers look wrong in commentary | Add column headers to your P&L range so Claude understands the context |

---

## Security Notes

- **Never commit your `.env` file** — it contains your API key
- The `.env.example` file is safe to commit (no real keys)
- For production: use environment variables in your hosting platform instead of `.env`
- Consider adding API rate limiting to the Flask backend for shared deployments
