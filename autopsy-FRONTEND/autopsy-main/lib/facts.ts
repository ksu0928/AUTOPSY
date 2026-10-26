/**
 * Facts builder - compact JSON for LLM narration
 * Evidence index for validation
 */

import type {
  Facts,
  BuildFactsParams,
  EvidenceIndex,
  SegmentContribution,
} from "./types";

/**
 * Build compact facts object from analysis results
 * @param params Analysis results
 * @returns Compact facts with rounded values
 */
export function buildFacts(params: BuildFactsParams): Facts {
  const { rows, metric, anomaly, contributions, missingPct } = params;

  // Round values
  const change_pct = roundPct(anomaly.changePct);
  const baseline = roundValue(anomaly.baseline);
  const observed = roundValue(anomaly.observed);

  // Top segments (limit to 5)
  const top_segments = contributions.slice(0, 5).map((c) => ({
    dimension: c.dimension,
    value: c.value,
    contribution_pct: roundPct(c.contributionPct),
    change_pct: roundPct(c.changePct),
  }));

  return {
    metric,
    period: anomaly.period,
    change_pct,
    baseline,
    observed,
    top_segments,
    data_quality: {
      rows: rows.length,
      missing_pct: roundPct(missingPct),
    },
  };
}

/**
 * Build evidence index mapping keys to values
 * Used for validation that LLM only uses facts numbers
 * @param facts Facts object
 * @returns Index of all evidence values
 */
export function buildEvidenceIndex(facts: Facts): EvidenceIndex {
  const index: EvidenceIndex = {};

  // Top-level numbers
  index["change_pct"] = facts.change_pct;
  index["baseline"] = facts.baseline;
  index["observed"] = facts.observed;

  // Period components (extract week/day numbers)
  index["period"] = facts.period;
  const periodNumbers = extractNumbers(facts.period);
  periodNumbers.forEach((num, i) => {
    index[`period_number_${i}`] = num;
  });

  // Segment contributions
  facts.top_segments.forEach((seg, i) => {
    index[`top_segments[${i}].contribution_pct`] = seg.contribution_pct;
    index[`top_segments[${i}].change_pct`] = seg.change_pct;
    index[`top_segments[${i}].dimension`] = seg.dimension;
    index[`top_segments[${i}].value`] = seg.value;
  });

  // Data quality
  index["data_quality.rows"] = facts.data_quality.rows;
  index["data_quality.missing_pct"] = facts.data_quality.missing_pct;

  // Add rounded variants for validation
  const numericValues = Object.values(index).filter(
    (v) => typeof v === "number"
  ) as number[];

  numericValues.forEach((val) => {
    // Add absolute value
    const abs = Math.abs(val);
    index[`abs_${val}`] = abs;

    // Add rounded variants
    index[`round0_${val}`] = Math.round(val);
    index[`round1_${val}`] = Math.round(val * 10) / 10;
  });

  return index;
}

/**
 * Round percentage to 1 decimal place
 */
function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Round value to integer
 */
function roundValue(value: number): number {
  return Math.round(value);
}

/**
 * Extract numeric components from a string (e.g., week numbers, years)
 */
function extractNumbers(str: string): number[] {
  const matches = str.match(/\d+/g);
  return matches ? matches.map(Number) : [];
}
