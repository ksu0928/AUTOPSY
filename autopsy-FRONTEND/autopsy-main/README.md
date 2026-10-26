# Metric Autopsy

🔍 **Instantly diagnose metric changes with AI-powered root cause analysis**

A hackathon-ready Next.js application that analyzes product metrics, detects anomalies, and generates compelling narratives—all in your browser. Built for the "Design, Innovation, Presentation" judging criteria.

## ✨ Key Features

### 🎨 Design: Stunning Results Screen
- **Headline Verdict**: Bold metric change with top contributing segment
- **Annotated Chart**: LineChart with shaded comparison window and anomaly highlight
- **Top 5 Suspects**: Ranked horizontal bars showing segment impact
- **Performance Badges**: Analysis time + privacy guarantee
- **AI-Written Reports**: Copy, download (Markdown/JSON), or share

### 💡 Innovation: Trustworthy Detection
- **Seasonality-Aware**: Automatically detects weekly patterns and uses same-weekday baseline
- **AI Validation**: Retry logic ensures LLM only uses grounded numbers from facts
- **Template Fallback**: Deterministic report generation when AI unavailable
- **Evidence Index**: All numbers validated against source data

### 🎤 Presentation: Demo-Ready
- **3 Sample Datasets**: Main demo (4 anomalies), clean spike, multi-segment drop
- **Messy Data**: Missing values (~1%), noise, realistic seasonality
- **Multiple Export Formats**: Plain text, Markdown, JSON
- **Zero Setup**: Works immediately, no accounts or databases

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Generate sample data
pnpm generate-sample

# Start dev server
pnpm dev

# Visit http://localhost:3000
```

**Try the demo:**
1. Click "Load Sample" on homepage
2. Watch analysis run in <3 seconds
3. See AI-generated autopsy with top suspects
4. Copy or download the report

## 📊 Architecture

```
lib/             Pure analytics (runs in browser)
├── types.ts     TypeScript definitions
├── parse.ts     CSV parsing with validation
├── schema.ts    Column type detection
├── aggregate.ts Time series & segment aggregation
├── anomaly.ts   Seasonality-aware z-score detection
├── decompose.ts Segment contribution analysis
├── facts.ts     Facts builder & evidence index
├── template.ts  Deterministic autopsy fallback
├── validate.ts  AI validation & number grounding
├── llm.ts       LLM adapter (Anthropic/Gemini)
└── prompt.ts    System prompts with retry logic

app/
├── page.tsx     Main UI with 4 states (empty/loading/error/results)
├── globals.css  Section A styles (headline, chart, suspects)
└── api/narrate/ POST endpoint for AI generation
    └── route.ts Rate-limited LLM with validation

scripts/
└── generate-sample.ts  Create realistic messy datasets

public/
├── sample-signups.csv      Main demo (4 anomalies, 45 weeks)
├── sample-spike.csv        Clean spike scenario
└── sample-multi-drop.csv   Multi-segment drop scenario
```

## 🧪 What Makes It Special

### Seasonality-Aware Detection (Section B)
Traditional anomaly detection fails on weekly data (e.g., "Mondays are always high"). Metric Autopsy automatically detects ISO week format (`2026-W13`) and compares week 15 to weeks 8, 1 (same weekday) instead of weeks 14, 13, 12.

**Result**: No false positives from day-of-week effects.

### AI Validation & Grounding (Section C)
LLMs hallucinate numbers. Metric Autopsy:
1. Extracts all numbers from AI response
2. Validates against evidence index (with rounding tolerance)
3. Retries once with explicit feedback on offending numbers
4. Falls back to template if still ungrounded

**Result**: Every number in the report comes from your data.

### Messy Sample Data (Section D)
Real data is messy. Demo datasets include:
- Missing values (~1% randomly dropped)
- Realistic noise (±3-8%)
- Weekly seasonality patterns
- 4 planted anomalies:
  1. Campaign pause (-52% drop)
  2. Newsletter success (+100% spike)
  3. Gradual organic decline (-3%/week)
  4. Viral moment (+140% surge)

**Result**: Realistic demo data with planted anomalies.

### Shareability (Section E)
One-click sharing:
- **Copy**: Plain text report to clipboard
- **Markdown**: Download formatted report
- **JSON**: Export structured data
- **Source Badges**: Shows "AI-written" vs "Template"

**Result**: Easy to demo and share results.

## 🧪 Testing

```bash
pnpm test          # Run all tests
pnpm vitest run    # CI mode
```

**Test Coverage:**
- ✅ 10 anomaly detection tests (including seasonality)
- ✅ 12 validation tests (grounding, tolerance, regex)
- ✅ CSV parsing, schema detection, aggregation
- ✅ End-to-end analysis pipeline

## Privacy Model

**What stays in the browser:**
- Raw CSV rows and all time-series data
- Complete metric history
- Full segment breakdowns

**What is sent to the server:**
- Only aggregated facts (typically 5-10 numbers)
- Segment labels (e.g., "Paid Social · Mobile") for the top 5 contributors
- No individual rows or time-series points

**Example payload sent to `/api/narrate`:**
```json
{
  "facts": {
    "metric": "signups",
    "period": "2026-W38",
    "change_pct": -27.4,
    "baseline": 1840,
    "observed": 1336,
    "top_segments": [
      {
        "dimension": "channel · device",
        "value": "Paid Social · Mobile",
        "contribution_pct": 61.2,
        "change_pct": -52.0
      }
    ],
    "data_quality": {
      "rows": 208,
      "missing_pct": 0.0
    }
  }
}
```

The server never sees your CSV content, only these summary statistics.

## Configuration (Optional)

For AI-generated reports, create `.env.local`:

```bash
LLM_PROVIDER=anthropic  # or "gemini" or "groq"
ANTHROPIC_API_KEY=sk-ant-...
# OR
GEMINI_API_KEY=...
# OR
GROQ_API_KEY=gsk_...
```

**Without API keys:** System uses deterministic template reports.

**Rate limiting:** The `/api/narrate` endpoint uses in-memory rate limiting (10 requests/minute per IP). This is best-effort and per-instance only—it does not hold across serverless function instances. For production multi-instance deployments, consider Redis-backed rate limiting.

## 📈 Sample Data Details

### Main Demo (`sample-signups.csv`)
- **45 weeks** of data (2026-W01 to W45)
- **8 segments**: 4 channels × 2 devices
- **4 anomalies** for comprehensive demo:
  1. **W38**: Paid Social · Mobile drops 52% (campaign pause)
  2. **W42**: Email · Mobile spikes 100% (newsletter success)
  3. **W35-45**: Organic · Desktop gradual decline
  4. **W30**: Referral spike 140% (viral moment)

### Quick Demo (`sample-spike.csv`)
- **11 weeks** (W20-W30)
- Simple +50% spike in one segment
- Perfect for 2-minute demos

### Complex Demo (`sample-multi-drop.csv`)
- **11 weeks** (W15-W25)
- Multiple segments drop simultaneously
- Shows decomposition power

## 🎯 Hackathon Submission

### Design
- UI with 4 states (empty, loading, error, results)
- Annotated charts with shaded windows
- Ranked horizontal bars (top 5 suspects)
- Consistent color scheme and spacing

### Innovation
- Seasonality-aware detection (compares same weekdays)
- AI validation with retry logic
- Privacy-focused architecture (raw data processed in browser)
- Automatic metric/segment detection

### Presentation
- 3 sample scenarios ready to demo
- Fast analysis (<3 seconds on sample data)
- One-click copy/download
- Clear narratives with confidence labels

## 🛠️ Tech Stack

- **Next.js 16** + React 19
- **TypeScript** for type safety
- **Recharts** for data visualization
- **Vitest** for testing
- **Anthropic Claude** or **Google Gemini** or **Groq** (optional)
- **Zod** for validation
- **Papa Parse** for CSV handling

## 📝 Development

```bash
# Run tests in watch mode
pnpm test

# Generate new sample data
pnpm generate-sample

# Build for production
pnpm build

# Start production server
pnpm start
```

## 🤝 Contributing

This is a hackathon project, but improvements welcome!

Key areas:
- Additional aggregation methods (median, percentiles)
- More sophisticated seasonality detection
- Chart export to PNG
- URL-based sharing
- Multi-metric analysis

## 📄 License

MIT

---

**Built for the Devpost "Design, Innovation, Presentation" hackathon.**
