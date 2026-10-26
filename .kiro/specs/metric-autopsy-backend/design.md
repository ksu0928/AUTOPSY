# Design: Metric Autopsy Backend

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌────────────┐    ┌──────────────┐    ┌─────────────┐    │
│  │ CSV Upload │───>│ lib/ modules │───>│ Facts JSON  │    │
│  └────────────┘    └──────────────┘    └──────┬──────┘    │
│                           │                     │            │
│                           │                     │            │
│                           v                     v            │
│                    ┌──────────────┐    ┌─────────────┐    │
│                    │ Vitest Tests │    │ POST to API │    │
│                    └──────────────┘    └──────┬──────┘    │
└────────────────────────────────────────────────┼───────────┘
                                                  │
                                                  v
┌─────────────────────────────────────────────────────────────┐
│                      Next.js Server                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         app/api/narrate/route.ts                     │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐    │   │
│  │  │ Validate │─>│ Rate     │─>│ LLM Adapter   │    │   │
│  │  │ (Zod)    │  │ Limit    │  │ (Anthropic/   │    │   │
│  │  └──────────┘  └──────────┘  │  Gemini)      │    │   │
│  │                               └───────┬───────┘    │   │
│  │                                       │            │   │
│  │                               ┌───────v───────┐    │   │
│  │                               │ Validate &    │    │   │
│  │                               │ Verify        │    │   │
│  │                               │ Numbers       │    │   │
│  │                               └───────┬───────┘    │   │
│  │                                       │            │   │
│  │                               ┌───────v───────┐    │   │
│  │                               │ Return        │    │   │
│  │                               │ Autopsy       │    │   │
│  │                               └───────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Parse**: CSV text → typed rows with quality metrics
2. **Schema**: Rows → column classification (date, metrics, segments)
3. **Aggregate**: Rows + schema → time series and segment views
4. **Anomaly**: Time series → significant period with statistics
5. **Decompose**: Segment views + anomaly → ranked contributions
6. **Facts**: All above → compact JSON facts object
7. **Narrate**: Facts → LLM or template → validated autopsy

## Type System

### Core Types (lib/types.ts)

```typescript
// Parsed CSV row
type Row = Record<string, string | number | null>;

// Schema detection result
type SchemaGuess = {
  dateColumn: string;
  metricColumns: string[];
  segmentColumns: string[];
  confidence: Record<string, "high" | "low">;
};

// Time series point
type PeriodPoint = {
  period: string;
  value: number;
  count?: number;
};

// Anomaly detection result
type AnomalyResult = {
  period: string;
  observed: number;
  baseline: number;
  sd: number;
  z: number;
  changePct: number;
  significant: boolean;
  lowConfidence?: boolean;
};

// Segment contribution
type SegmentContribution = {
  dimension: string;
  value: string;
  contribution: number;
  contributionPct: number;
  changePct: number;
  mixShift?: number;
  rateChange?: number;
};

// Facts payload (browser → server)
type Facts = {
  metric: string;
  period: string;
  change_pct: number;
  baseline: number;
  observed: number;
  top_segments: Array<{
    dimension: string;
    value: string;
    contribution_pct: number;
    change_pct: number;
  }>;
  data_quality: {
    rows: number;
    missing_pct: number;
  };
};

// LLM or template output
type Autopsy = {
  headline: string; // max 120 chars
  summary: string;
  hypotheses: Array<{
    title: string;
    reasoning: string;
    confidence: "supported" | "needs_validation";
    evidence_keys: string[];
  }>;
  next_experiment: string;
};

// API types
type NarrateRequest = { facts: Facts };
type NarrateResponse = {
  autopsy: Autopsy;
  source: "llm" | "template";
  notice?: string;
};
```

## Module Design

### lib/parse.ts

**Exports**: `parseCsv(text: string): ParseResult`

**Algorithm**:
1. Check size: reject if text.length > 5 * 1024 * 1024
2. PapaParse with config: `{ header: true, skipEmptyLines: true, dynamicTyping: false }`
3. For each row:
   - Trim all string values
   - Detect numeric strings (after stripping thousands separators: `,` and spaces)
   - Coerce to number or keep as string
4. Count missing values across all cells
5. Return: `{ rows: Row[], missingPct: number, errors: ParseError[] }`

**Error handling**: Typed `ParseError` with `code: "SIZE_EXCEEDED" | "PARSE_FAILED"`

### lib/schema.ts

**Exports**: `detectSchema(rows: Row[]): SchemaGuess`

**Algorithm**:
1. For each column:
   - **Date test**: Try parsing with date-fns or custom regex for ISO week
     - Formats: ISO 8601, `YYYY-MM-DD`, `2026-W38`, `MM/DD/YYYY`
     - Threshold: ≥80% parse success
   - **Metric test**: Parse as number (already coerced), threshold ≥90%
   - **Segment test**: Count distinct values, accept 2–20 unique values
2. Select first date column as `dateColumn`
3. Collect all metric columns except date
4. Collect all segment columns
5. Confidence: "high" if date is 100% valid and metrics/segments are unambiguous; otherwise "low"
6. Never throw; return partial results with low confidence

**Edge cases**:
- No date column found → empty string, confidence "low"
- Multiple date candidates → pick first, confidence "low"
- Numeric column with few values → treat as metric if numeric, segment if categorical

### lib/aggregate.ts

**Exports**:
- `aggregateByPeriod(rows: Row[], schema: SchemaGuess, metric: string): PeriodPoint[]`
- `aggregateBySegment(rows: Row[], schema: SchemaGuess, metric: string, dimension: string, period: string): SegmentPoint[]`

**Granularity detection**:
- Check date format: if ISO week or weekly pattern → "week"
- If dates span multiple days → "day"
- Default: "day"

**Aggregation logic**:
```typescript
function getAggregationMethod(metricName: string, rows: Row[]): "sum" | "mean" | "weightedAvg" {
  if (/rate|ratio|pct|conversion/i.test(metricName)) {
    // Look for denominator column (e.g., "signups_total" for "signups_rate")
    const denomCol = findDenominatorColumn(metricName, rows);
    if (denomCol) return "weightedAvg";
    return "mean";
  }
  return "sum";
}
```

**Weighted average**: `sum(value[i] * weight[i]) / sum(weight[i])`

**Output**: Sorted by period ascending

### lib/anomaly.ts

**Exports**: `findAnomaly(series: PeriodPoint[], options?: AnomalyOptions): AnomalyResult`

**Options**:
```typescript
type AnomalyOptions = {
  windowSize?: 4 | 6 | 8; // default 6
  zThreshold?: number;     // default 2
  pctThreshold?: number;   // default 15
};
```

**Algorithm**:
1. For each period i (starting from windowSize + 1):
   - Extract window: `series[i - windowSize ... i - 1]`
   - Compute `baseline = mean(window)`
   - Compute `sd = sampleStdDev(window)` using simple-statistics
   - Compute `observed = series[i].value`
   - If `sd === 0`:
     - `z = observed !== baseline ? Infinity : 0`
   - Else:
     - `z = (observed - baseline) / sd`
   - Compute `changePct = ((observed - baseline) / baseline) * 100`
   - Qualifies if `abs(z) >= zThreshold OR abs(changePct) >= pctThreshold`
2. Select period with max `abs(z)` among qualifying periods
3. Set `lowConfidence = true` if `series.length < 8`
4. Return result with `significant: true` if any qualify, else `significant: false`

**Library usage**: `mean()` and `sampleStandardDeviation()` from simple-statistics

### lib/decompose.ts

**Exports**:
- `decompose(params: DecomposeParams): SegmentContribution[]`
- `decomposeTwo(params: DecomposeTwoParams): SegmentContribution[]`

**DecomposeParams**:
```typescript
type DecomposeParams = {
  rows: Row[];
  schema: SchemaGuess;
  metric: string;
  dimension: string;
  anomalyPeriod: string;
  windowSize: number;
};
```

**Algorithm (single dimension)**:
1. Aggregate by segment for anomaly period: `A_s` per segment
2. Aggregate by segment for baseline window: `B_s = mean over window`
3. Compute totals: `A_total`, `B_total`
4. If `A_total === B_total`: return empty with reason
5. For each segment:
   - `contribution = (A_s - B_s) / (A_total - B_total)`
   - `contributionPct = contribution * 100`
   - `changePct = ((A_s - B_s) / B_s) * 100`
6. For ratio metrics: compute `mixShift` and `rateChange` (mix-shift decomposition)
7. Sort by `abs(contribution)` descending

**Algorithm (two dimensions)**:
- Cross-join dimension values: `channel × device`
- Each segment is `{ dimension: "channel · device", value: "Paid Social · Mobile" }`
- Apply same contribution formula

**Output**: Top N segments (caller decides cutoff, typically 5)

### lib/facts.ts

**Exports**:
- `buildFacts(params: BuildFactsParams): Facts`
- `buildEvidenceIndex(facts: Facts): Record<string, number | string>`

**Rounding**:
```typescript
function roundValue(v: number): number { return Math.round(v); }
function roundPct(v: number): number { return Math.round(v * 10) / 10; }
```

**Evidence index keys**:
- `"change_pct"` → `facts.change_pct`
- `"baseline"` → `facts.baseline`
- `"observed"` → `facts.observed`
- `"top_segments[0].contribution_pct"` → first segment contribution
- `"period"` → period string (extract week/day number)
- All numeric values from facts, deduplicated

### lib/template.ts

**Exports**: `templateAutopsy(facts: Facts): Autopsy`

**Template structure**:
```typescript
const headline = `${facts.metric} ${facts.change_pct > 0 ? "rose" : "fell"} ${Math.abs(facts.change_pct)}% in ${facts.period}`;

const summary = `In ${facts.period}, ${facts.metric} changed from ${facts.baseline} to ${facts.observed} (${facts.change_pct > 0 ? "+" : ""}${facts.change_pct}%). Analysis of ${facts.data_quality.rows} rows identified ${facts.top_segments.length} contributing segments.`;

const hypotheses = [
  {
    title: `${facts.top_segments[0].dimension}: ${facts.top_segments[0].value}`,
    reasoning: `This segment contributed ${facts.top_segments[0].contribution_pct}% of the total change, with a ${facts.top_segments[0].change_pct}% shift in this period.`,
    confidence: "supported",
    evidence_keys: ["top_segments[0].contribution_pct", "top_segments[0].change_pct"]
  },
  {
    title: "Potential external factors",
    reasoning: `Changes of this magnitude may reflect campaign timing, seasonality, or market shifts that warrant further investigation.`,
    confidence: "needs_validation",
    evidence_keys: ["change_pct", "period"]
  }
];

const next_experiment = `Drill into ${facts.top_segments[0].dimension} cohorts during ${facts.period} to isolate root cause.`;
```

### lib/validate.ts

**Exports**:
- `autopsySchema: z.ZodSchema<Autopsy>`
- `numbersAreGrounded(autopsy: Autopsy, facts: Facts): string[]`

**autopsySchema**:
```typescript
const autopsySchema = z.object({
  headline: z.string().max(120),
  summary: z.string(),
  hypotheses: z.array(z.object({
    title: z.string(),
    reasoning: z.string(),
    confidence: z.enum(["supported", "needs_validation"]),
    evidence_keys: z.array(z.string())
  })).min(2).max(3),
  next_experiment: z.string()
}).strict();
```

**numbersAreGrounded algorithm**:
1. Extract all numbers from autopsy text fields using regex: `/[-+]?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?%?/g`
2. Parse each match to numeric value (handle %, commas)
3. Build allowed values from `buildEvidenceIndex(facts)`:
   - Exact value
   - Absolute value
   - Rounded to 0 decimals
   - Rounded to 1 decimal
   - Week/period numbers extracted from `facts.period`
4. For each extracted number:
   - Check if it matches any allowed value (within ±0.05 for rounding)
   - If no match, add to offending list
5. Return offending numbers as string array

### lib/llm.ts

**Exports**: `LLMAdapter` interface and implementations

**Interface**:
```typescript
interface LLMAdapter {
  generate(system: string, user: string, timeout: number): Promise<string>;
}

function createLLMAdapter(provider: "anthropic" | "gemini", apiKey: string): LLMAdapter;
```

**Implementations**:
- **AnthropicAdapter**: Uses `@anthropic-ai/sdk` or fetch to POST to Anthropic API
  - Model: `claude-3-5-sonnet-20241022`
  - Max tokens: 2000
  - Temperature: 0 (deterministic)
  - AbortSignal for timeout
- **GeminiAdapter**: Uses `@google/generative-ai` or fetch
  - Model: `gemini-1.5-pro-latest`
  - Temperature: 0
  - AbortSignal for timeout

**Error handling**: Throw on network error, timeout, or non-2xx; caller handles fallback

### lib/prompt.ts

**Exports**: `buildSystemPrompt(): string`, `buildUserPrompt(facts: Facts): string`

**System prompt**:
```
You are an analytics narrative generator. You will receive a facts object containing pre-computed metrics. Your task:

1. Write a compelling autopsy of the metric change
2. Use ONLY numbers that appear in the facts object
3. Format your response as JSON matching this schema:
   {
     "headline": "...",  // max 120 chars
     "summary": "...",
     "hypotheses": [
       {
         "title": "...",
         "reasoning": "...",
         "confidence": "supported" | "needs_validation",
         "evidence_keys": ["..."]
       }
     ],  // 2-3 hypotheses
     "next_experiment": "..."
   }
4. Label each hypothesis "supported" (by the data) or "needs_validation" (requires further investigation)
5. Never claim causation from correlation alone
6. Reference evidence_keys that exist in the facts object
7. Respond with JSON only, no markdown fences
8. Be concise and actionable
```

**User prompt**:
```
Facts: ${JSON.stringify(facts, null, 2)}

Generate an autopsy report.
```

**Retry prompt (on ungrounded numbers)**:
```
The previous response contained numbers not present in the facts: ${offendingNumbers.join(", ")}

Regenerate using ONLY the numbers provided in the facts object.
```

### app/api/narrate/route.ts

**Exports**: `POST` handler

**Flow**:
```typescript
export async function POST(req: Request) {
  // 1. Parse and validate body
  const body = await req.json();
  const validation = narrateRequestSchema.safeParse(body);
  if (!validation.success) {
    return Response.json({ error: "Invalid request", field: ... }, { status: 400 });
  }
  const { facts } = validation.data;

  // 2. Rate limit
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!rateLimiter.allow(ip)) {
    return Response.json({ error: "Rate limit exceeded" }, { 
      status: 429,
      headers: { "Retry-After": "60" }
    });
  }

  // 3. Check LLM config
  const provider = process.env.LLM_PROVIDER;
  const apiKey = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY;
  
  if (!provider || !apiKey) {
    return templateFallback(facts);
  }

  // 4. Try LLM
  const adapter = createLLMAdapter(provider, apiKey);
  let autopsy: Autopsy;
  let source: "llm" | "template" = "llm";
  
  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(facts);
    
    let responseText = await adapter.generate(systemPrompt, userPrompt, 8000);
    responseText = stripCodeFences(responseText);
    
    let parsed = JSON.parse(responseText);
    autopsy = autopsySchema.parse(parsed);
    
    // Validate grounded numbers
    const offending = numbersAreGrounded(autopsy, facts);
    if (offending.length > 0) {
      // Retry once
      const retryPrompt = buildRetryPrompt(facts, offending);
      responseText = await adapter.generate(systemPrompt, retryPrompt, 8000);
      responseText = stripCodeFences(responseText);
      parsed = JSON.parse(responseText);
      autopsy = autopsySchema.parse(parsed);
      
      const stillOffending = numbersAreGrounded(autopsy, facts);
      if (stillOffending.length > 0) {
        throw new Error("Ungrounded numbers persist");
      }
    }
  } catch (error) {
    // Log error (but not facts)
    console.error("LLM failed, using template", { error: error.message });
    return templateFallback(facts);
  }

  // 5. Success
  logRequest({ status: 200, latency: ..., source });
  return Response.json({ autopsy, source });
}

function templateFallback(facts: Facts) {
  const autopsy = templateAutopsy(facts);
  logRequest({ status: 200, latency: ..., source: "template" });
  return Response.json({
    autopsy,
    source: "template",
    notice: "This report was generated from a template because the writing service did not respond."
  });
}
```

**Rate limiter** (in-memory):
```typescript
class TokenBucket {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();
  
  allow(key: string, limit = 10, window = 60000): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) || { tokens: limit, lastRefill: now };
    
    // Refill
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor(elapsed / window) * limit;
    bucket.tokens = Math.min(limit, bucket.tokens + refill);
    bucket.lastRefill = now;
    
    // Check
    if (bucket.tokens > 0) {
      bucket.tokens--;
      this.buckets.set(key, bucket);
      return true;
    }
    return false;
  }
}
```

## Sample Data Generator

**scripts/generate-sample.ts**:
```typescript
import seedrandom from "seedrandom";

const rng = seedrandom("metric-autopsy-2026");
const channels = ["Organic", "Paid Social", "Email", "Referral"];
const devices = ["Mobile", "Desktop"];

const baseline = {
  "Organic · Mobile": 320,
  "Organic · Desktop": 185,
  "Paid Social · Mobile": 593,
  "Paid Social · Desktop": 287,
  "Email · Mobile": 198,
  "Email · Desktop": 142,
  "Referral · Mobile": 86,
  "Referral · Desktop": 29
};

const noise = () => 1 + (rng() - 0.5) * 0.06; // ±3%

const weeks = [];
for (let w = 13; w <= 38; w++) {
  const period = `2026-W${w.toString().padStart(2, "0")}`;
  
  for (const channel of channels) {
    for (const device of devices) {
      const key = `${channel} · ${device}`;
      let signups = Math.round(baseline[key] * noise());
      
      // Plant anomaly
      if (w === 38 && key === "Paid Social · Mobile") {
        signups = Math.round(285 + (rng() - 0.5) * 10);
      }
      
      weeks.push({ week: period, channel, device, signups });
    }
  }
}

// Write to public/sample-signups.csv
```

**Commit**: Generated CSV is committed to repo

## Testing Strategy

### Unit Tests (Vitest)

**parse.test.ts**:
- Thousands separators: `"1,234"` → `1234`
- Empty rows skipped
- Oversize rejection: 6 MB string throws

**schema.test.ts**:
- Sample CSV: detects `week`, `signups`, `channel`, `device` with high confidence
- Messy CSV: returns low confidence without throwing
- Edge: no date column returns empty string + low confidence

**aggregate.test.ts**:
- Sum for count metrics
- Weighted average for ratio metrics with denominator
- Period sorting

**anomaly.test.ts**:
- Z-score matches hand calculation
- Percent change threshold triggers
- SD = 0 with different value → z = Infinity
- Fewer than 8 periods sets lowConfidence
- No qualifying period → significant = false

**decompose.test.ts**:
- Sample data: Paid Social · Mobile ≈ 61% contribution
- Contributions sum to ≈ 100%
- A_total = B_total returns empty + reason

**validate.test.ts**:
- Grounded numbers: `"27.4%"` when facts.change_pct = 27.4 → pass
- Invented number: `"43%"` not in facts → fail
- Rounding: `"27%"` when facts = 27.4 → pass

### API Tests

**Mock LLM adapter**:
```typescript
const mockAdapter: LLMAdapter = {
  generate: vi.fn().mockResolvedValue(JSON.stringify(validAutopsy))
};
```

**Scenarios**:
- Success: valid Facts → LLM returns valid Autopsy → 200 + source: "llm"
- Invalid JSON: LLM returns malformed → template fallback
- Ungrounded numbers: LLM returns "43%" → retry → still bad → template
- Timeout: 8s exceeded → template + notice
- Invalid body: extra key → 400 + field error
- Rate limit: 11th request in 1 min → 429 + Retry-After

### End-to-End Test

**e2e.test.ts**:
1. Load public/sample-signups.csv
2. Parse → detect schema → aggregate → find anomaly → decompose
3. Build facts
4. Assert: `facts.period === "2026-W38"`
5. Assert: `facts.top_segments[0].value === "Paid Social · Mobile"`
6. Assert: `facts.top_segments[0].contribution_pct ≈ 61` (±2)
7. POST to /api/narrate (mock LLM)
8. Assert: response.autopsy.hypotheses mentions "Paid Social" or "Mobile"

## Privacy Design

**No raw data on server**:
- Client aggregates and computes facts locally
- Only Facts JSON crosses network boundary
- Facts object contains no row-level data

**No logging of sensitive data**:
```typescript
function logRequest(meta: { status: number; latency: number; source: string }) {
  // Log only metadata, never facts or prompts
  console.log(JSON.stringify(meta));
}

// Test: assert console.log never called with objects containing facts keys
```

## Performance Design

**Optimization strategies**:
1. Use simple-statistics for fast aggregation (C++ bindings where available)
2. Single-pass aggregation: compute sum/count/mean in one loop
3. Hash map for segment lookups: O(1) access
4. Lazy evaluation: compute only requested metrics
5. Early exit: stop after finding max z-score
6. No deep cloning: pass references where safe

**Benchmark target**: 10,000 rows in <3 seconds on modern hardware

## Error Handling

**Parse errors**: Return `{ rows: [], missingPct: 0, errors: [...] }`
**Schema errors**: Return low confidence, never throw
**Aggregation errors**: Return empty array if no valid data
**Anomaly errors**: Return `{ significant: false }` if no anomaly
**Decomposition errors**: Return empty with reason if A_total = B_total
**LLM errors**: Fall back to template, log error (no details)
**API errors**: Return 400/429/500 with typed error object

## Configuration

**.env.example**:
```
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=
```

**Runtime**: Checked at request time; missing config → template autopsy

## Dependencies

**Production**:
- `papaparse`: CSV parsing
- `simple-statistics`: Statistical functions
- `zod`: Runtime validation
- `@anthropic-ai/sdk` or `@google/generative-ai`: LLM clients (optional, can use fetch)

**Development**:
- `vitest`: Test runner
- `@types/papaparse`: TypeScript types
- `seedrandom`: PRNG for sample generation

**Total**: Minimal footprint, no heavy frameworks

## Deployment Considerations

- **Serverless-friendly**: No persistent state
- **Edge-compatible**: lib/ modules run in browser, worker, or Node
- **Environment variables**: LLM keys loaded from process.env
- **Rate limiting**: In-memory (single instance); use Redis for multi-instance
- **Monitoring**: Log latency and source; alert on high template fallback rate

## Future Extensions (Out of Scope)

- Multi-metric analysis
- Causal inference (uplift testing)
- Streaming LLM responses
- Custom prompt templates
- Alternative LLM providers (OpenAI, Claude Opus)
- Database persistence of facts
- User accounts and saved analyses
