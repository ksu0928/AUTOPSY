/**
 * Schema detection for CSV columns
 * Identifies date, metric, and segment columns with confidence scoring
 */

import type { Row, SchemaGuess } from "./types";

const DATE_THRESHOLD = 0.8; // 80% of values must parse as dates
const METRIC_THRESHOLD = 0.9; // 90% must be numeric
const MIN_SEGMENT_VALUES = 2;
const MAX_SEGMENT_VALUES = 20;

/**
 * Detect column types from parsed rows
 * @param rows Parsed CSV rows
 * @returns Schema guess with confidence scores
 */
export function detectSchema(rows: Row[]): SchemaGuess {
  if (rows.length === 0) {
    return {
      dateColumn: "",
      metricColumns: [],
      segmentColumns: [],
      confidence: {},
    };
  }

  const columns = Object.keys(rows[0]);
  const dateColumns: Array<{ col: string; score: number }> = [];
  const metricColumns: Array<{ col: string; score: number }> = [];
  const segmentColumns: Array<{ col: string; distinct: number }> = [];

  for (const col of columns) {
    const values = rows.map((r) => r[col]).filter((v) => v !== null);
    if (values.length === 0) continue;

    // Test for date column
    const dateScore = testDateColumn(values);
    if (dateScore >= DATE_THRESHOLD) {
      dateColumns.push({ col, score: dateScore });
      continue; // Don't test as metric or segment
    }

    // Test for metric column (numeric)
    const numericCount = values.filter((v) => typeof v === "number").length;
    const metricScore = numericCount / values.length;
    if (metricScore >= METRIC_THRESHOLD) {
      metricColumns.push({ col, score: metricScore });
      continue;
    }

    // Test for segment column (categorical with limited values)
    const distinct = new Set(values).size;
    if (distinct >= MIN_SEGMENT_VALUES && distinct <= MAX_SEGMENT_VALUES) {
      segmentColumns.push({ col, distinct });
    }
  }

  // Select best date column
  dateColumns.sort((a, b) => b.score - a.score);
  const dateColumn = dateColumns[0]?.col || "";

  // Collect all metrics
  const metrics = metricColumns.map((m) => m.col);

  // Collect all segments
  const segments = segmentColumns.map((s) => s.col);

  // Compute confidence
  const confidence: Record<string, "high" | "low"> = {};

  // Date confidence
  if (dateColumn) {
    const score = dateColumns[0].score;
    confidence[dateColumn] = score >= 0.95 ? "high" : "low";
    if (dateColumns.length > 1) {
      confidence[dateColumn] = "low"; // Ambiguous
    }
  }

  // Metric confidence
  for (const m of metricColumns) {
    confidence[m.col] = m.score >= 0.98 ? "high" : "low";
  }

  // Segment confidence
  for (const s of segmentColumns) {
    // High confidence if distinct count is reasonable
    confidence[s.col] =
      s.distinct >= 2 && s.distinct <= 10 ? "high" : "low";
  }

  // Overall confidence: high only if all detected columns are high
  const hasLowConfidence = Object.values(confidence).some((c) => c === "low");
  if (hasLowConfidence || !dateColumn || metrics.length === 0) {
    // Mark all as low if any ambiguity
    for (const key of Object.keys(confidence)) {
      if (confidence[key] === "low") {
        // Already low
      } else if (!dateColumn || metrics.length === 0) {
        confidence[key] = "low";
      }
    }
  }

  return {
    dateColumn,
    metricColumns: metrics,
    segmentColumns: segments,
    confidence,
  };
}

/**
 * Test if values parse as dates
 * @param values Column values
 * @returns Score from 0 to 1
 */
function testDateColumn(values: (string | number)[]): number {
  let validCount = 0;

  for (const value of values) {
    if (isValidDate(value)) {
      validCount++;
    }
  }

  return validCount / values.length;
}

/**
 * Check if a value is a valid date
 * Supports: ISO 8601, YYYY-MM-DD, ISO week (2026-W38), MM/DD/YYYY
 */
function isValidDate(value: string | number): boolean {
  if (typeof value === "number") return false;

  const str = String(value).trim();

  // ISO week format: 2026-W38
  if (/^\d{4}-W\d{2}$/.test(str)) {
    const [year, week] = str.split("-W").map(Number);
    return year >= 1900 && year <= 2100 && week >= 1 && week <= 53;
  }

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const date = new Date(str);
    return !isNaN(date.getTime());
  }

  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const [month, day, year] = str.split("/").map(Number);
    const date = new Date(year, month - 1, day);
    return !isNaN(date.getTime());
  }

  // ISO 8601 (catch-all)
  const date = new Date(str);
  return !isNaN(date.getTime()) && str.length >= 8; // Reasonable date string length
}
