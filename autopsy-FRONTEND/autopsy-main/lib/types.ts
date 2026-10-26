 /**
 * Core type definitions for Metric Autopsy backend
 * All types are pure data structures with no side effects
 */

// ============================================================================
// Data Structures
// ============================================================================

/** Parsed CSV row with typed values */
export type Row = Record<string, string | number | null>;

/** Column classification result from schema detection */
export interface SchemaGuess {
  dateColumn: string;
  metricColumns: string[];
  segmentColumns: string[];
  confidence: Record<string, "high" | "low">;
}

/** Time series data point */
export interface PeriodPoint {
  period: string;
  value: number;
  count?: number;
}

/** Anomaly detection result */
export interface AnomalyResult {
  period: string;
  observed: number;
  baseline: number;
  sd: number;
  z: number;
  changePct: number;
  significant: boolean;
  lowConfidence?: boolean;
}

/** Segment contribution to total change */
export interface SegmentContribution {
  dimension: string;
  value: string;
  contribution: number;
  contributionPct: number;
  changePct: number;
  mixShift?: number;
  rateChange?: number;
}

/** Compact facts object (browser → server) */
export interface Facts {
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
}

/** Generated or LLM autopsy report */
export interface Autopsy {
  headline: string;
  summary: string;
  hypotheses: Array<{
    title: string;
    reasoning: string;
    confidence: "supported" | "needs_validation";
    evidence_keys: string[];
  }>;
  next_experiment: string;
}

// ============================================================================
// API Types
// ============================================================================

export interface NarrateRequest {
  facts: Facts;
}

export interface NarrateResponse {
  autopsy: Autopsy;
  source: "llm" | "template";
  notice?: string;
}

// ============================================================================
// Parse Types
// ============================================================================

export interface ParseResult {
  rows: Row[];
  missingPct: number;
  errors: ParseError[];
}

export interface ParseError {
  code: "SIZE_EXCEEDED" | "PARSE_FAILED";
  message: string;
  row?: number;
}

// ============================================================================
// Aggregation Types
// ============================================================================

export interface AggregateOptions {
  method?: "sum" | "mean" | "weightedAvg";
  denominatorColumn?: string;
}

export interface SegmentPoint {
  segment: string;
  value: number;
  count?: number;
}

// ============================================================================
// Anomaly Detection Types
// ============================================================================

export interface AnomalyOptions {
  windowSize?: 4 | 6 | 8;
  zThreshold?: number;
  pctThreshold?: number;
}

// ============================================================================
// Decomposition Types
// ============================================================================

export interface DecomposeParams {
  rows: Row[];
  schema: SchemaGuess;
  metric: string;
  dimension: string;
  anomalyPeriod: string;
  windowSize: number;
}

export interface DecomposeTwoParams {
  rows: Row[];
  schema: SchemaGuess;
  metric: string;
  dimension1: string;
  dimension2: string;
  anomalyPeriod: string;
  windowSize: number;
}

export interface DecomposeResult {
  contributions: SegmentContribution[];
  reason?: string;
}

// ============================================================================
// Facts Builder Types
// ============================================================================

export interface BuildFactsParams {
  rows: Row[];
  schema: SchemaGuess;
  metric: string;
  anomaly: AnomalyResult;
  contributions: SegmentContribution[];
  missingPct: number;
}
export type LLMProvider = "anthropic" | "gemini" | "groq";
export type EvidenceIndex = Record<string, number | string>;

// ============================================================================
// LLM Adapter Types
// ============================================================================

export interface LLMAdapter {
  generate(system: string, user: string, timeout: number): Promise<string>;
}

export type LLMProvider = "anthropic" | "gemini";

// ============================================================================
// Legacy UI Types (for compatibility)
// ============================================================================

/** @deprecated Use SegmentContribution instead */
export interface Segment {
  dimension: string;
  value: string;
  contribution_pct: number;
  change_pct: number;
}
