/**
 * Segment contribution analysis
 * Ranks which segments drove the anomaly
 */

import { aggregateBySegment } from "./aggregate";
import type {
  Row,
  SchemaGuess,
  SegmentContribution,
  DecomposeParams,
  DecomposeTwoParams,
  DecomposeResult,
} from "./types";

/**
 * Decompose anomaly by single dimension
 * @param params Decomposition parameters
 * @returns Ranked segment contributions
 */
export function decompose(params: DecomposeParams): DecomposeResult {
  const { rows, schema, metric, dimension, anomalyPeriod, windowSize } = params;

  // Get anomaly period segments
  const anomalySegments = aggregateBySegment(
    rows,
    schema,
    metric,
    dimension,
    anomalyPeriod
  );

  // Get baseline segments (mean over window before anomaly)
  const baselineSegments = computeBaselineSegments(
    rows,
    schema,
    metric,
    dimension,
    anomalyPeriod,
    windowSize
  );

  // Calculate totals
  let A_total = 0;
  let B_total = 0;

  for (const [segment, value] of anomalySegments.entries()) {
    A_total += value;
  }

  for (const [segment, value] of baselineSegments.entries()) {
    B_total += value;
  }

  // Handle edge case: no change
  if (A_total === B_total) {
    return {
      contributions: [],
      reason: "Total value unchanged between baseline and anomaly period",
    };
  }

  // Calculate contributions
  const contributions: SegmentContribution[] = [];

  const allSegments = new Set([
    ...anomalySegments.keys(),
    ...baselineSegments.keys(),
  ]);

  for (const segment of allSegments) {
    const A_s = anomalySegments.get(segment) || 0;
    const B_s = baselineSegments.get(segment) || 0;

    const contribution = (A_s - B_s) / (A_total - B_total);
    const contributionPct = contribution * 100;
    const changePct = B_s !== 0 ? ((A_s - B_s) / B_s) * 100 : 0;

    contributions.push({
      dimension,
      value: segment,
      contribution,
      contributionPct,
      changePct,
    });
  }

  // Sort by absolute contribution
  contributions.sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)
  );

  return { contributions };
}

/**
 * Decompose anomaly by two dimensions (cross-segment)
 * @param params Decomposition parameters with two dimensions
 * @returns Ranked cross-segment contributions
 */
export function decomposeTwo(params: DecomposeTwoParams): DecomposeResult {
  const {
    rows,
    schema,
    metric,
    dimension1,
    dimension2,
    anomalyPeriod,
    windowSize,
  } = params;

  const { dateColumn } = schema;
  if (!dateColumn) {
    return {
      contributions: [],
      reason: "No date column found",
    };
  }

  // Build cross-segment aggregates
  const anomalyCross = computeCrossSegments(
    rows,
    dateColumn,
    metric,
    dimension1,
    dimension2,
    anomalyPeriod
  );

  const baselineCross = computeBaselineCrossSegments(
    rows,
    dateColumn,
    metric,
    dimension1,
    dimension2,
    anomalyPeriod,
    windowSize
  );

  // Calculate totals
  let A_total = 0;
  let B_total = 0;

  for (const value of anomalyCross.values()) {
    A_total += value;
  }

  for (const value of baselineCross.values()) {
    B_total += value;
  }

  // Handle edge case
  if (A_total === B_total) {
    return {
      contributions: [],
      reason: "Total value unchanged between baseline and anomaly period",
    };
  }

  // Calculate contributions
  const contributions: SegmentContribution[] = [];
  const allKeys = new Set([...anomalyCross.keys(), ...baselineCross.keys()]);

  for (const key of allKeys) {
    const A_s = anomalyCross.get(key) || 0;
    const B_s = baselineCross.get(key) || 0;

    const contribution = (A_s - B_s) / (A_total - B_total);
    const contributionPct = contribution * 100;
    const changePct = B_s !== 0 ? ((A_s - B_s) / B_s) * 100 : 0;

    contributions.push({
      dimension: `${dimension1} · ${dimension2}`,
      value: key,
      contribution,
      contributionPct,
      changePct,
    });
  }

  // Sort by absolute contribution
  contributions.sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)
  );

  return { contributions };
}

/**
 * Compute baseline mean for each segment
 */
function computeBaselineSegments(
  rows: Row[],
  schema: SchemaGuess,
  metric: string,
  dimension: string,
  anomalyPeriod: string,
  windowSize: number
): Map<string, number> {
  const { dateColumn } = schema;
  if (!dateColumn) return new Map();

  // Find anomaly period index
  const periods = Array.from(
    new Set(
      rows
        .map((r) => String(r[dateColumn] || "").trim())
        .filter((p) => p !== "")
    )
  ).sort();

  const anomalyIndex = periods.indexOf(anomalyPeriod);
  if (anomalyIndex < windowSize) {
    return new Map();
  }

  // Get window periods
  const windowPeriods = periods.slice(anomalyIndex - windowSize, anomalyIndex);

  // Aggregate by segment for each window period
  const segmentSums = new Map<string, number>();
  const segmentCounts = new Map<string, number>();

  for (const period of windowPeriods) {
    const periodSegments = aggregateBySegment(
      rows,
      schema,
      metric,
      dimension,
      period
    );

    for (const [segment, value] of periodSegments.entries()) {
      segmentSums.set(segment, (segmentSums.get(segment) || 0) + value);
      segmentCounts.set(segment, (segmentCounts.get(segment) || 0) + 1);
    }
  }

  // Compute means
  const means = new Map<string, number>();
  for (const [segment, sum] of segmentSums.entries()) {
    const count = segmentCounts.get(segment) || 1;
    means.set(segment, sum / count);
  }

  return means;
}

/**
 * Compute cross-segment aggregates for a period
 */
function computeCrossSegments(
  rows: Row[],
  dateColumn: string,
  metric: string,
  dimension1: string,
  dimension2: string,
  period: string
): Map<string, number> {
  const result = new Map<string, number>();

  for (const row of rows) {
    const rowPeriod = String(row[dateColumn] || "").trim();
    if (rowPeriod !== period) continue;

    const d1 = String(row[dimension1] || "").trim();
    const d2 = String(row[dimension2] || "").trim();
    const value = row[metric];

    if (!d1 || !d2 || value === null || typeof value !== "number") continue;

    const key = `${d1} · ${d2}`;
    result.set(key, (result.get(key) || 0) + value);
  }

  return result;
}

/**
 * Compute baseline cross-segment means
 */
function computeBaselineCrossSegments(
  rows: Row[],
  dateColumn: string,
  metric: string,
  dimension1: string,
  dimension2: string,
  anomalyPeriod: string,
  windowSize: number
): Map<string, number> {
  // Find periods
  const periods = Array.from(
    new Set(
      rows
        .map((r) => String(r[dateColumn] || "").trim())
        .filter((p) => p !== "")
    )
  ).sort();

  const anomalyIndex = periods.indexOf(anomalyPeriod);
  if (anomalyIndex < windowSize) {
    return new Map();
  }

  const windowPeriods = periods.slice(anomalyIndex - windowSize, anomalyIndex);

  const sums = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const period of windowPeriods) {
    const periodCross = computeCrossSegments(
      rows,
      dateColumn,
      metric,
      dimension1,
      dimension2,
      period
    );

    for (const [key, value] of periodCross.entries()) {
      sums.set(key, (sums.get(key) || 0) + value);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const means = new Map<string, number>();
  for (const [key, sum] of sums.entries()) {
    const count = counts.get(key) || 1;
    means.set(key, sum / count);
  }

  return means;
}
