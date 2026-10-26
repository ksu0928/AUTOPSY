/**
 * Anomaly detection using z-score and percentage change
 * Seasonality-aware: uses same-weekday baseline for weekly data
 */

import { mean, sampleStandardDeviation } from "simple-statistics";
import type { PeriodPoint, AnomalyResult, AnomalyOptions } from "./types";

const DEFAULT_WINDOW_SIZE = 6;
const DEFAULT_Z_THRESHOLD = 2;
const DEFAULT_PCT_THRESHOLD = 15;
const LOW_CONFIDENCE_THRESHOLD = 8;

/**
 * Find the most significant anomaly in a time series
 * Automatically detects weekly patterns and uses same-weekday baseline
 * @param series Time series data
 * @param options Detection parameters
 * @returns Anomaly result with significance flag
 */
export function findAnomaly(
  series: PeriodPoint[],
  options: AnomalyOptions = {}
): AnomalyResult {
  const windowSize = options.windowSize || DEFAULT_WINDOW_SIZE;
  const zThreshold = options.zThreshold || DEFAULT_Z_THRESHOLD;
  const pctThreshold = options.pctThreshold || DEFAULT_PCT_THRESHOLD;

  // Check for low confidence
  const lowConfidence = series.length < LOW_CONFIDENCE_THRESHOLD;

  // Need at least windowSize + 1 periods
  if (series.length <= windowSize) {
    return {
      period: series[series.length - 1]?.period || "",
      observed: series[series.length - 1]?.value || 0,
      baseline: 0,
      sd: 0,
      z: 0,
      changePct: 0,
      significant: false,
      lowConfidence: true,
    };
  }

  // Detect if data is weekly (ISO week format: YYYY-W##)
  const isWeekly = detectWeeklyPattern(series);

  const candidates: Array<{
    period: string;
    observed: number;
    baseline: number;
    sd: number;
    z: number;
    changePct: number;
  }> = [];

  // Test each period starting from windowSize + 1
  for (let i = windowSize; i < series.length; i++) {
    let window: PeriodPoint[];
    let windowValues: number[];

    if (isWeekly) {
      // Use same-weekday baseline (every 7th period back)
      window = getSameWeekdayWindow(series, i, windowSize);
      windowValues = window.map((p) => p.value);
    } else {
      // Use rolling window (default behavior)
      window = series.slice(i - windowSize, i);
      windowValues = window.map((p) => p.value);
    }

    const baseline = mean(windowValues);
    const sd = sampleStandardDeviation(windowValues);
    const observed = series[i].value;

    // Calculate z-score
    let z: number;
    if (sd === 0) {
      // SD = 0: treat as infinite z only if value differs
      z = observed !== baseline ? Infinity : 0;
    } else {
      z = (observed - baseline) / sd;
    }

    // Calculate percentage change
    const changePct = baseline !== 0 ? ((observed - baseline) / baseline) * 100 : 0;

    // Check if qualifies
    const qualifies =
      Math.abs(z) >= zThreshold || Math.abs(changePct) >= pctThreshold;

    if (qualifies) {
      candidates.push({
        period: series[i].period,
        observed,
        baseline,
        sd,
        z,
        changePct,
      });
    }
  }

  // Select candidate with largest |z|
  if (candidates.length === 0) {
    const last = series[series.length - 1];
    return {
      period: last.period,
      observed: last.value,
      baseline: last.value,
      sd: 0,
      z: 0,
      changePct: 0,
      significant: false,
      lowConfidence,
    };
  }

  candidates.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const selected = candidates[0];

  return {
    period: selected.period,
    observed: selected.observed,
    baseline: selected.baseline,
    sd: selected.sd,
    z: selected.z,
    changePct: selected.changePct,
    significant: true,
    lowConfidence,
  };
}

/**
 * Detect if time series uses weekly periods (ISO week format)
 * @param series Time series data
 * @returns True if weekly pattern detected
 */
function detectWeeklyPattern(series: PeriodPoint[]): boolean {
  if (series.length < 3) return false;

  // Check if periods match ISO week format: YYYY-W## (e.g., "2026-W13")
  const weekPattern = /^\d{4}-W\d{2}$/;
  
  // Sample first 3 periods
  const samples = series.slice(0, 3);
  const matchCount = samples.filter(p => weekPattern.test(p.period)).length;

  return matchCount >= 2; // At least 2 out of 3 match
}

/**
 * Get same-weekday baseline window for weekly data
 * Returns every 7th period going backwards from current index
 * @param series Time series data
 * @param currentIndex Current period index
 * @param windowSize Number of same-weekday periods to include
 * @returns Array of same-weekday periods
 */
function getSameWeekdayWindow(
  series: PeriodPoint[],
  currentIndex: number,
  windowSize: number
): PeriodPoint[] {
  const window: PeriodPoint[] = [];

  // Go back by 7-period intervals (same weekday)
  for (let w = 1; w <= windowSize; w++) {
    const targetIndex = currentIndex - (w * 7);
    
    if (targetIndex >= 0 && targetIndex < series.length) {
      window.push(series[targetIndex]);
    }
  }

  // If we don't have enough same-weekday data, fall back to recent window
  if (window.length < Math.min(3, windowSize)) {
    return series.slice(Math.max(0, currentIndex - windowSize), currentIndex);
  }

  return window;
}
