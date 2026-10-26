# Tasks: Metric Autopsy Backend

## Phase 1: Foundation & Types

### Task 1.1: Project Setup
- [ ] Install dependencies: `papaparse`, `simple-statistics`, `zod`, `vitest`, `@types/papaparse`, `seedrandom`
- [ ] Configure TypeScript strict mode in tsconfig.json
- [ ] Configure Vitest in vitest.config.ts
- [ ] Create .env.example with LLM_PROVIDER, ANTHROPIC_API_KEY, GEMINI_API_KEY
- [ ] Add lib/ directory

**Acceptance**: Dependencies installed, TypeScript compiles, Vitest runs

---

### Task 1.2: Core Type Definitions
- [ ] Create lib/types.ts with all type exports:
  - Row, Schema, SchemaGuess
  - PeriodPoint, AnomalyResult, SegmentContribution
  - Facts, Autopsy
  - NarrateRequest, NarrateResponse
  - ParseResult, ParseError types
  - DecomposeParams, AnomalyOptions

**Acceptance**: All types compile, exported, and documented with TSDoc

---

## Phase 2: Data Processing Pipeline

### Task 2.1: CSV Parser
- [ ] Implement lib/parse.ts with parseCsv function
- [ ] Size check: reject text > 5 MB before parsing
- [ ] PapaParse integration: header: true, skipEmptyLines: true
- [ ] Trim all header names and string values
- [ ] Detect and strip thousands separators (`,` and spaces)
- [ ] Coerce numeric strings to numbers
- [ ] Calculate missing value percentage
- [ ] Return ParseResult with rows, missingPct, errors

**Acceptance**: Unit tests pass for thousands separators, empty rows, oversize rejection

---

### Task 2.2: Schema Detection
- [ ] Implement lib/schema.ts with detectSchema function
- [ ] Date column detection:
  - Test formats: ISO 8601, YYYY-MM-DD, ISO week (2026-W38), MM/DD/YYYY
  - Threshold: ≥80% valid parses
- [ ] Metric column detection: numeric ≥90%, exclude date column
- [ ] Segment column detection: string with 2–20 distinct values
- [ ] Confidence scoring: "high" when unambiguous, otherwise "low"
- [ ] Never throw on ambiguity; return partial results

**Acceptance**: Sample CSV detects week/signups/channel/device with high confidence; messy CSV returns low confidence

---

### Task 2.3: Aggregation Functions
- [ ] Implement lib/aggregate.ts with:
  - aggregateByPeriod(rows, schema, metric): PeriodPoint[]
  - aggregateBySegment(rows, schema, metric, dimension, period): SegmentPoint[]
- [ ] Auto-detect granularity (day vs week) from date format
- [ ] Aggregation method selection:
  - Sum for count metrics
  - Weighted average for ratio metrics with denominator
  - Mean otherwise
- [ ] Sort output by period ascending

**Acceptance**: Unit tests verify sum/weighted-avg logic, sorted output

---

### Task 2.4: Anomaly Detection
- [ ] Implement lib/anomaly.ts with findAnomaly function
- [ ] Rolling window baseline: mean and sample standard deviation
- [ ] Z-score calculation with SD = 0 handling (treat as infinite when value differs)
- [ ] Qualification logic: |z| >= zThreshold OR |changePct| >= pctThreshold
- [ ] Select max |z| among qualifying periods
- [ ] Set lowConfidence when series.length < 8
- [ ] Return significant: false when no periods qualify

**Acceptance**: Unit tests verify z-score against hand calculations, SD=0 case, lowConfidence flag

---

### Task 2.5: Segment Decomposition
- [ ] Implement lib/decompose.ts with:
  - decompose(params): SegmentContribution[]
  - decomposeTwo(params): SegmentContribution[] for two dimensions
- [ ] Contribution formula: (A_s − B_s) / (A_total − B_total)
- [ ] Compute baseline B_s as mean over comparison window
- [ ] Handle A_total = B_total case (return empty with reason)
- [ ] For ratio metrics: compute mixShift and rateChange
- [ ] Support two-dimension cross (e.g., channel × device)
- [ ] Sort by absolute contribution descending

**Acceptance**: Sample data shows Paid Social · Mobile ≈61%; contributions sum to ≈100%; A_total=B_total handled

---

## Phase 3: Facts & Narrative

### Task 3.1: Facts Builder
- [ ] Implement lib/facts.ts with:
  - buildFacts(params): Facts
  - buildEvidenceIndex(facts): Record<string, number | string>
- [ ] Rounding: percentages to 1 decimal, values to integers
- [ ] Ensure no raw rows in Facts object
- [ ] Evidence index maps keys like "change_pct", "top_segments[0].contribution_pct" to values
- [ ] Extract period numbers from facts.period for grounding

**Acceptance**: Facts object is compact, rounded correctly, evidence index complete

---

### Task 3.2: Template Autopsy
- [ ] Implement lib/template.ts with templateAutopsy function
- [ ] Deterministic output using only facts values
- [ ] Generate headline (under 120 chars)
- [ ] Generate summary with facts.rows, facts.baseline, facts.observed
- [ ] Generate 2 hypotheses:
  - Hypothesis 1: top segment with contribution_pct and change_pct
  - Hypothesis 2: external factors (needs_validation)
- [ ] Generate next_experiment referencing top segment

**Acceptance**: Output is deterministic, uses only facts values, passes autopsySchema

---

### Task 3.3: Validation Logic
- [ ] Implement lib/validate.ts with:
  - autopsySchema (Zod): headline max 120, 2-3 hypotheses, one next_experiment, strict mode
  - numbersAreGrounded(autopsy, facts): string[]
- [ ] Number extraction regex: handle %, commas, decimals, minus signs
- [ ] Build allowed values from evidence index:
  - Exact, absolute, rounded to 0 and 1 decimal
  - Week/period numbers from facts.period
- [ ] Match extracted numbers to allowed (within ±0.05 rounding tolerance)
- [ ] Return list of offending numbers

**Acceptance**: Unit tests verify grounded numbers pass, invented numbers fail, rounding variants pass

---

## Phase 4: LLM Integration

### Task 4.1: LLM Adapter Interface
- [ ] Implement lib/llm.ts with:
  - LLMAdapter interface: generate(system, user, timeout): Promise<string>
  - createLLMAdapter(provider, apiKey): LLMAdapter
- [ ] AnthropicAdapter implementation:
  - Use @anthropic-ai/sdk or fetch
  - Model: claude-3-5-sonnet-20241022
  - Temperature: 0, max tokens: 2000
  - AbortController for 8s timeout
- [ ] GeminiAdapter implementation:
  - Use @google/generative-ai or fetch
  - Model: gemini-1.5-pro-latest
  - Temperature: 0
  - AbortController for 8s timeout
- [ ] Error handling: throw on timeout, network error, non-2xx

**Acceptance**: Both adapters make successful API calls (integration test with real keys optional)

---

### Task 4.2: Prompt Engineering
- [ ] Implement lib/prompt.ts with:
  - buildSystemPrompt(): string
  - buildUserPrompt(facts): string
  - buildRetryPrompt(facts, offendingNumbers): string
- [ ] System prompt rules:
  - Use only numbers in facts
  - Label confidence: "supported" | "needs_validation"
  - Never claim causation
  - Respond JSON only, no markdown
  - Exactly one next_experiment
- [ ] User prompt: stringify facts
- [ ] Retry prompt: list offending numbers, request regeneration

**Acceptance**: Prompts are clear, constraints are explicit, retry logic is actionable

---

## Phase 5: API Route

### Task 5.1: Rate Limiter
- [ ] Implement in-memory token bucket rate limiter
- [ ] Configuration: 10 requests per minute per IP
- [ ] Extract IP from x-forwarded-for header
- [ ] Return false when limit exceeded
- [ ] Refill tokens over time

**Acceptance**: Unit test verifies 10 requests pass, 11th fails, tokens refill after 1 minute

---

### Task 5.2: API Route Implementation
- [ ] Create app/api/narrate/route.ts with POST handler
- [ ] Export runtime = "nodejs"
- [ ] Zod validation of request body (strict mode, reject extra keys)
- [ ] Return 400 with { error, field } on invalid body
- [ ] Apply rate limiting: return 429 with Retry-After on exceed
- [ ] Check LLM config (LLM_PROVIDER, API keys)
- [ ] If no config: return templateFallback immediately
- [ ] LLM flow:
  1. Call adapter.generate with system + user prompts, 8s timeout
  2. Strip code fences (```json ... ```)
  3. JSON.parse
  4. Validate with autopsySchema
  5. Check numbersAreGrounded
  6. If offending numbers: retry once with buildRetryPrompt
  7. If still offending or any error: templateFallback
- [ ] Return { autopsy, source, notice? }
- [ ] Logging: status, latency, source only (never facts, prompts, or LLM output)

**Acceptance**: API tests pass for all scenarios (success, invalid JSON, ungrounded, timeout, 400, 429)

---

### Task 5.3: Privacy Test
- [ ] Create test that monitors console.log/error/warn calls
- [ ] Assert no call receives facts payload or any PII
- [ ] Use vi.spyOn to intercept console methods
- [ ] Test should fail if facts object is logged

**Acceptance**: Test fails when facts are logged, passes when only metadata is logged

---

## Phase 6: Sample Data & Testing

### Task 6.1: Sample Data Generator
- [ ] Create scripts/generate-sample.ts
- [ ] Use seedrandom with seed "metric-autopsy-2026"
- [ ] Generate 26 weeks (2026-W13 to 2026-W38)
- [ ] Channels: Organic, Paid Social, Email, Referral
- [ ] Devices: Mobile, Desktop
- [ ] Baseline per segment (total ≈1,840/week):
  - Paid Social · Mobile: 593
  - Others: distributed to sum to ≈1,840
- [ ] Add ±3% noise using PRNG
- [ ] Plant anomaly in 2026-W38:
  - Paid Social · Mobile drops to 285 (−52%)
  - Total drops to ≈1,336 (−27.4%)
  - Other segments stay within noise
- [ ] Write CSV to public/sample-signups.csv
- [ ] Commit generated CSV

**Acceptance**: Generated CSV is reproducible (seeded), anomaly is planted correctly

---

### Task 6.2: Unit Tests - Parse & Schema
- [ ] parse.test.ts:
  - Thousands separators: "1,234" → 1234
  - Empty rows skipped
  - Oversize rejection: 6 MB throws ParseError
- [ ] schema.test.ts:
  - Sample CSV: detects week, signups, channel, device with high confidence
  - Messy CSV: low confidence, no throw
  - No date column: empty string + low confidence

**Acceptance**: All tests pass

---

### Task 6.3: Unit Tests - Aggregate & Anomaly
- [ ] aggregate.test.ts:
  - Sum for count metrics
  - Weighted average for ratio with denominator
  - Period sorting ascending
- [ ] anomaly.test.ts:
  - Z-score matches hand calculation
  - Percent threshold triggers
  - SD = 0 with different value → z = Infinity
  - series.length < 8 sets lowConfidence
  - No qualifying period → significant = false

**Acceptance**: All tests pass with hand-verified values

---

### Task 6.4: Unit Tests - Decompose & Validate
- [ ] decompose.test.ts:
  - Sample data: Paid Social · Mobile ≈61% contribution (±2%)
  - Contributions sum to ≈100% (±2%)
  - A_total = B_total returns empty + reason
- [ ] validate.test.ts:
  - Grounded: "27.4%" when facts.change_pct = 27.4 → pass
  - Invented: "43%" not in facts → fail
  - Rounding: "27%" when facts = 27.4 → pass
  - Period numbers: "38" from "2026-W38" → pass

**Acceptance**: All tests pass

---

### Task 6.5: API Integration Tests
- [ ] Create app/api/narrate/route.test.ts
- [ ] Mock LLM adapter with vi.fn()
- [ ] Test scenarios:
  1. Success: valid autopsy → 200 + source: "llm"
  2. Invalid JSON: malformed response → template fallback
  3. Ungrounded numbers: "43%" → retry → still bad → template
  4. Timeout: 8s exceeded → template + notice
  5. Invalid body: extra key → 400 + field error
  6. Rate limit: 11 requests → 429 + Retry-After
- [ ] Verify response structure matches NarrateResponse type

**Acceptance**: All API tests pass

---

### Task 6.6: End-to-End Test
- [ ] Create tests/e2e.test.ts
- [ ] Load public/sample-signups.csv
- [ ] Parse → schema → aggregate → anomaly → decompose
- [ ] Build facts
- [ ] Assert facts.period === "2026-W38"
- [ ] Assert facts.top_segments[0].value contains "Paid Social" and "Mobile"
- [ ] Assert facts.top_segments[0].contribution_pct ≈ 61 (±2)
- [ ] POST to /api/narrate (mock LLM for determinism)
- [ ] Assert response.autopsy mentions key segment in hypotheses

**Acceptance**: E2E test passes, planted cause is detected and surfaces in output

---

## Phase 7: Documentation & Polish

### Task 7.1: README Backend Section
- [ ] Add "Backend" section to README.md
- [ ] Document architecture: lib/ modules, /api/narrate
- [ ] Installation: dependencies, .env setup
- [ ] Usage: import lib modules, call API
- [ ] Testing: `pnpm test`
- [ ] Sample data: public/sample-signups.csv usage
- [ ] Privacy guarantee: no raw data on server

**Acceptance**: README is clear and complete

---

### Task 7.2: Performance Verification
- [ ] Create performance benchmark test
- [ ] Generate 10,000 row dataset (scaled sample)
- [ ] Run full pipeline: parse → schema → aggregate → anomaly → decompose → facts
- [ ] Measure elapsed time
- [ ] Assert < 3 seconds on reasonable hardware

**Acceptance**: Benchmark passes consistently

---

### Task 7.3: Type Exports & API Surface
- [ ] Verify all lib/ modules export types
- [ ] Create lib/index.ts barrel export (optional, for convenience)
- [ ] Ensure tree-shaking friendly (no side effects)
- [ ] Document public API with TSDoc comments

**Acceptance**: All exports are typed, documented, and importable

---

### Task 7.4: Final Integration Check
- [ ] Run full test suite: `pnpm test`
- [ ] Verify TypeScript compiles with no errors: `pnpm tsc --noEmit`
- [ ] Run sample analysis manually
- [ ] Test API endpoint with curl/Postman (if LLM keys available)
- [ ] Check .env.example is complete

**Acceptance**: All tests pass, no type errors, API responds correctly

---

## Summary

**Total Tasks**: 24 organized in 7 phases
**Estimated Effort**: 
- Phase 1-2: Foundation (4 tasks) - Core data pipeline
- Phase 3: Facts & Narrative (3 tasks) - Business logic
- Phase 4: LLM Integration (2 tasks) - AI layer
- Phase 5: API Route (3 tasks) - Server endpoint
- Phase 6: Testing (6 tasks) - Quality assurance
- Phase 7: Documentation (4 tasks) - Polish

**Critical Path**: 
1. Types → Parse → Schema → Aggregate → Anomaly → Decompose
2. Facts → Template → Validate
3. LLM Adapter → Prompts → API Route
4. Sample Data → Tests → Documentation

**Dependencies**:
- Phase 2 depends on Phase 1
- Phase 3 depends on Phase 2
- Phase 4 can proceed in parallel with Phase 5.1
- Phase 5.2 depends on Phase 3, 4, and 5.1
- Phase 6 depends on all previous phases
- Phase 7 runs last

**Acceptance Criteria Met**:
- ✅ Sample CSV analysis identifies 2026-W38 and Paid Social · Mobile (Task 6.6)
- ✅ LLM ungrounded numbers trigger retry then template (Task 5.2, 6.5)
- ✅ LLM failures return template with notice (Task 5.2)
- ✅ 10,000 rows processed in <3s (Task 7.2)
- ✅ No raw rows sent to server or logged (Task 5.3, REQ-10.1-10.4)
