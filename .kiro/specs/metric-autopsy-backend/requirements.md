# Requirements: Metric Autopsy Backend

## Overview

A pure client-side analytics engine with minimal server narration service. Users upload CSV metric files, the browser detects schema and computes anomalies and segment decompositions, then optionally requests a plain-English narrative from a server endpoint that never sees raw data.

## Non-Goals

- User accounts or authentication
- Database persistence or saved history
- Live data connectors or external integrations
- Forecasting or predictive analytics
- Multi-file joins or complex ETL
- Files over 5 MB
- UI components (backend only)

## Functional Requirements (EARS Format)

### Data Ingestion

**REQ-1.1**: WHEN a user provides CSV text under 5 MB, THE SYSTEM SHALL parse it with header detection, trim whitespace, coerce numeric values (removing thousands separators), and skip empty rows.

**REQ-1.2**: WHEN CSV text exceeds 5 MB, THE SYSTEM SHALL reject the input with a typed error before parsing.

**REQ-1.3**: WHEN parsing completes, THE SYSTEM SHALL return rows, missing value percentage, and any parse errors.

### Schema Detection

**REQ-2.1**: WHEN analyzing rows, THE SYSTEM SHALL identify date columns by successful parsing of at least 80% of values in formats: ISO 8601, YYYY-MM-DD, ISO week (2026-W38), or MM/DD/YYYY.

**REQ-2.2**: WHEN analyzing rows, THE SYSTEM SHALL identify metric columns as numeric columns (excluding the date column) where at least 90% of values parse as numbers.

**REQ-2.3**: WHEN analyzing rows, THE SYSTEM SHALL identify segment columns as string columns with 2–20 distinct values.

**REQ-2.4**: WHEN schema signals are unambiguous, THE SYSTEM SHALL mark confidence as "high"; otherwise "low".

**REQ-2.5**: THE SYSTEM SHALL NOT throw exceptions on ambiguous schema; it SHALL return low confidence instead.

### Aggregation

**REQ-3.1**: WHEN aggregating by period, THE SYSTEM SHALL auto-detect granularity as daily or weekly and return sorted PeriodPoint arrays.

**REQ-3.2**: WHEN aggregating count metrics, THE SYSTEM SHALL use sum aggregation.

**REQ-3.3**: WHEN aggregating metrics matching /rate|ratio|pct|conversion/i and a denominator column exists, THE SYSTEM SHALL compute weighted average; otherwise mean.

**REQ-3.4**: WHEN aggregating by segment, THE SYSTEM SHALL group by dimension and period using the appropriate aggregation method.

### Anomaly Detection

**REQ-4.1**: WHEN analyzing time series with window size (4, 6, or 8 periods), THE SYSTEM SHALL compute rolling baseline as mean and sample standard deviation of previous windowSize periods.

**REQ-4.2**: WHEN a period's z-score absolute value >= 2 OR absolute change percentage >= 15%, THE SYSTEM SHALL mark it as qualifying.

**REQ-4.3**: WHEN multiple periods qualify, THE SYSTEM SHALL select the period with largest absolute z-score.

**REQ-4.4**: WHEN standard deviation = 0 and value differs from mean, THE SYSTEM SHALL treat z-score as infinite.

**REQ-4.5**: WHEN fewer than 8 periods exist, THE SYSTEM SHALL set lowConfidence flag to true.

**REQ-4.6**: WHEN no periods qualify, THE SYSTEM SHALL return significant = false.

**REQ-4.7**: WHEN the sample CSV is analyzed, THE SYSTEM SHALL identify 2026-W38 as the anomaly and Paid Social · Mobile as the top segment, 100% of runs.

### Segment Decomposition

**REQ-5.1**: WHEN decomposing by dimension, THE SYSTEM SHALL compute each segment's contribution as (A_s − B_s) / (A_total − B_total), where B_s is the segment's mean over the comparison window.

**REQ-5.2**: WHEN decomposing, THE SYSTEM SHALL return each segment's change percentage.

**REQ-5.3**: WHEN decomposing ratio metrics, THE SYSTEM SHALL separate mix shift from rate change.

**REQ-5.4**: WHEN A_total = B_total, THE SYSTEM SHALL return empty results with a reason.

**REQ-5.5**: THE SYSTEM SHALL support two-dimension cross-segmentation (e.g., channel × device).

**REQ-5.6**: THE SYSTEM SHALL sort segments by absolute contribution.

### Facts Generation

**REQ-6.1**: WHEN building facts, THE SYSTEM SHALL round percentages to 1 decimal place and values to integers.

**REQ-6.2**: THE SYSTEM SHALL NOT include raw rows in the facts object.

**REQ-6.3**: THE SYSTEM SHALL provide an evidence index mapping evidence keys to values for validation.

### Narrative Generation

**REQ-7.1**: WHEN generating template autopsy, THE SYSTEM SHALL use only values from the facts object.

**REQ-7.2**: THE SYSTEM SHALL produce deterministic output including headline, summary, 2 hypotheses, and 1 experiment.

### Validation

**REQ-8.1**: WHEN validating autopsy structure, THE SYSTEM SHALL enforce: headline <= 120 characters, 2–3 hypotheses, exactly one next_experiment string.

**REQ-8.2**: WHEN validating autopsy, THE SYSTEM SHALL require all evidence_keys to exist in the evidence index.

**REQ-8.3**: WHEN validating grounded numbers, THE SYSTEM SHALL extract all numbers from text fields and match each to facts values within rounding tolerance (exact, rounded to 0 or 1 decimal, absolute value).

**REQ-8.4**: WHEN validating, THE SYSTEM SHALL allow week/period numbers appearing in facts.period.

**REQ-8.5**: WHEN ungrounded numbers are found, THE SYSTEM SHALL return the offending numbers.

### API Endpoint

**REQ-9.1**: WHEN receiving POST /api/narrate requests, THE SYSTEM SHALL validate the body against { facts: Facts } schema with strict mode.

**REQ-9.2**: WHEN request body is invalid, THE SYSTEM SHALL return 400 with { error, field } and reject extra keys.

**REQ-9.3**: WHEN an IP exceeds 10 requests per minute, THE SYSTEM SHALL return 429 with Retry-After header.

**REQ-9.4**: WHEN LLM_PROVIDER environment variable is not set or API key is missing, THE SYSTEM SHALL return template autopsy without calling LLM.

**REQ-9.5**: WHEN LLM call succeeds, THE SYSTEM SHALL strip code fences, parse JSON, validate schema, and check grounded numbers.

**REQ-9.6**: WHEN the LLM returns any number not derivable from the facts, THE SYSTEM SHALL retry once and then return the template autopsy.

**REQ-9.7**: WHEN LLM call fails, times out (8 seconds), or produces invalid output twice, THE SYSTEM SHALL return template autopsy.

**REQ-9.8**: WHEN the LLM call fails or times out, THE SYSTEM SHALL return the template autopsy with the specified notice.

**REQ-9.9**: WHEN returning template autopsy, THE SYSTEM SHALL include source: "template" and notice: "This report was generated from a template because the writing service did not respond."

**REQ-9.10**: WHEN returning LLM autopsy, THE SYSTEM SHALL include source: "llm".

**REQ-9.11**: THE SYSTEM SHALL complete LLM calls within 8 seconds using AbortController timeout.

### Privacy & Security

**REQ-10.1**: THE SYSTEM SHALL NOT send raw CSV rows to the server.

**REQ-10.2**: THE SYSTEM SHALL NOT log request bodies, facts, prompts, or LLM output.

**REQ-10.3**: THE SYSTEM SHALL log only status, latency, and source for API requests.

**REQ-10.4**: THE SYSTEM SHALL have a test that fails if console methods receive facts payload.

## Performance Requirements

**REQ-11.1**: WHEN analyzing 10,000 rows, THE SYSTEM SHALL complete aggregation, anomaly detection, and decomposition in under 3 seconds.

## Sample Data

**REQ-12.1**: THE SYSTEM SHALL provide a sample dataset generator using seeded PRNG.

**REQ-12.2**: THE SYSTEM SHALL generate public/sample-signups.csv with 26 weekly periods ending 2026-W38.

**REQ-12.3**: THE SAMPLE SHALL include columns: week, channel (Organic, Paid Social, Email, Referral), device (Mobile, Desktop), signups.

**REQ-12.4**: THE SAMPLE SHALL have baseline total ≈1,840 signups per week with ≈3% noise.

**REQ-12.5**: THE SAMPLE SHALL show Paid Social · Mobile dropping from ≈593 to ≈285 (−52%) in 2026-W38.

**REQ-12.6**: THE SAMPLE SHALL show total dropping ≈27.4% (1,840 to ≈1,336) in 2026-W38.

**REQ-12.7**: THE SAMPLE SHALL show Paid Social · Mobile accounting for ≈61% of the total drop.

**REQ-12.8**: THE SAMPLE SHALL keep all other segments within normal noise.

## Test Coverage

**REQ-13.1**: THE SYSTEM SHALL include unit tests for: parse (thousands separators, empty rows, oversize rejection).

**REQ-13.2**: THE SYSTEM SHALL include unit tests for: schema detection (sample CSV, messy CSV with low confidence).

**REQ-13.3**: THE SYSTEM SHALL include unit tests for: aggregate and anomaly (z-score, percent change, SD=0, <8 periods, no significant change).

**REQ-13.4**: THE SYSTEM SHALL include unit tests for: decompose (contributions on sample data, sum to ≈100%, A_total=B_total case).

**REQ-13.5**: THE SYSTEM SHALL include unit tests for: validate (grounded numbers pass, invented numbers fail, rounding variants pass).

**REQ-13.6**: THE SYSTEM SHALL include API tests for: LLM success, invalid JSON, ungrounded numbers, timeout, invalid body, rate limit.

**REQ-13.7**: THE SYSTEM SHALL include end-to-end test on sample CSV asserting planted cause appears in facts and response.

## Type Safety

**REQ-14.1**: THE SYSTEM SHALL use TypeScript strict mode.

**REQ-14.2**: THE SYSTEM SHALL fully type all exports: Row, Schema, SchemaGuess, PeriodPoint, AnomalyResult, SegmentContribution, Facts, Autopsy, NarrateRequest, NarrateResponse.

**REQ-14.3**: THE SYSTEM SHALL use Zod for runtime validation.

## Module Architecture

**REQ-15.1**: THE SYSTEM SHALL implement pure analytics library in lib/ (browser and Vitest compatible, no Node-only APIs, no side effects).

**REQ-15.2**: THE SYSTEM SHALL implement one server route: POST /api/narrate (runtime nodejs).

**REQ-15.3**: THE SYSTEM SHALL maintain module boundaries: parse, schema, aggregate, anomaly, decompose, facts, template, validate, llm, prompt.
