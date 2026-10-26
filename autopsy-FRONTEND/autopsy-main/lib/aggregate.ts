/**
 * Time series and segment aggregation
 * Automatic method selection based on metric type
 */

import type { Row, SchemaGuess, PeriodPoint, AggregateOptions } from "./types";

/**
 * Aggregate rows by time period
 * @param rows Parsed rows
 * @param schema Detected schema
 * @param metric Metric column name
 * @returns Sorted period points
 */
export function aggregateByPeriod(
  rows: Row[],
  schema: SchemaGuess,
  metric: string
): PeriodPoint[] {
  const { dateColumn } = schema;
  if (!dateColumn) return [];

  const method = selectAggregationMethod(metric, rows);
  const periodMap = new Map<string, { sum: number; count: number; weights: number }>();

  for (const row of rows) {
    const period = String(row[dateColumn] || "").trim();
    const value = row[metric];

    if (!period || value === null || typeof value !== "number") continue;

    const existing = periodMap.get(period) || { sum: 0, count: 0, weights: 0 };

    if (method === "weightedAvg") {
      // Find denominator column
      const denomCol = findDenominatorColumn(metric, rows);
      const weight = denomCol ? (row[denomCol] as number) || 0 : 1;
      existing.sum += value * weight;
      existing.weights += weight;
      existing.count++;
    } else {
      existing.sum += value;
      existing.count++;
    }

    periodMap.set(period, existing);
  }

  const points: PeriodPoint[] = [];
  for (const [period, data] of periodMap.entries()) {
    let value: number;

    if (method === "sum") {
      value = data.sum;
    } else if (method === "weightedAvg" && data.weights > 0) {
      value = data.sum / data.weights;
    } else if (method === "mean" && data.count > 0) {
      value = data.sum / data.count;
    } else {
      value = 0;
    }

    points.push({ period, value, count: data.count });
  }

  // Sort by period
  return points.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Aggregate rows by segment for a specific period
 * @param rows Parsed rows
 * @param schema Detected schema
 * @param metric Metric column name
 * @param dimension Segment dimension
 * @param period Period to filter (or null for all)
 * @returns Segment aggregates
 */
export function aggregateBySegment(
  rows: Row[],
  schema: SchemaGuess,
  metric: string,
  dimension: string,
  period: string | null = null
): Map<string, number> {
  const { dateColumn } = schema;
  const method = selectAggregationMethod(metric, rows);
  const segmentMap = new Map<string, { sum: number; count: number; weights: number }>();

  for (const row of rows) {
    // Filter by period if specified
    if (period !== null && dateColumn) {
      const rowPeriod = String(row[dateColumn] || "").trim();
      if (rowPeriod !== period) continue;
    }

    const segment = String(row[dimension] || "").trim();
    const value = row[metric];

    if (!segment || value === null || typeof value !== "number") continue;

    const existing = segmentMap.get(segment) || { sum: 0, count: 0, weights: 0 };

    if (method === "weightedAvg") {
      const denomCol = findDenominatorColumn(metric, rows);
      const weight = denomCol ? (row[denomCol] as number) || 0 : 1;
      existing.sum += value * weight;
      existing.weights += weight;
      existing.count++;
    } else {
      existing.sum += value;
      existing.count++;
    }

    segmentMap.set(segment, existing);
  }

  const result = new Map<string, number>();
  for (const [segment, data] of segmentMap.entries()) {
    let value: number;

    if (method === "sum") {
      value = data.sum;
    } else if (method === "weightedAvg" && data.weights > 0) {
      value = data.sum / data.weights;
    } else if (method === "mean" && data.count > 0) {
      value = data.sum / data.count;
    } else {
      value = 0;
    }

    result.set(segment, value);
  }

  return result;
}

/**
 * Select aggregation method based on metric name
 */
function selectAggregationMethod(
  metricName: string,
  rows: Row[]
): "sum" | "mean" | "weightedAvg" {
  // Check if metric name suggests a ratio
  if (/rate|ratio|pct|percentage|conversion/i.test(metricName)) {
    // Look for denominator column
    const denomCol = findDenominatorColumn(metricName, rows);
    if (denomCol) {
      return "weightedAvg";
    }
    return "mean";
  }

  return "sum";
}

/**
 * Find denominator column for weighted average
 */
function findDenominatorColumn(metricName: string, rows: Row[]): string | null {
  if (rows.length === 0) return null;

  const columns = Object.keys(rows[0]);

  // Look for total/count columns
  const candidates = columns.filter((col) =>
    /total|count|impressions|visits|sessions/i.test(col)
  );

  // Prefer column with similar name
  for (const candidate of candidates) {
    if (metricName.toLowerCase().includes(candidate.toLowerCase().replace(/_/g, ""))) {
      return candidate;
    }
  }

  return candidates[0] || null;
}
