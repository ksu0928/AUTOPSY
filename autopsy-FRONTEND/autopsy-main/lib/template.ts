/**
 * Template autopsy generator
 * Deterministic fallback when LLM is unavailable
 */

import type { Facts, Autopsy } from "./types";

/**
 * Generate deterministic autopsy from facts
 * @param facts Compact facts object
 * @returns Complete autopsy report
 */
export function templateAutopsy(facts: Facts): Autopsy {
  const { metric, period, change_pct, baseline, observed, top_segments } = facts;

  // Number formatter for consistent display
  const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

  // Direction and magnitude
  const direction = change_pct > 0 ? "rose" : "fell";
  const absPct = Math.abs(change_pct);

  // Headline (under 120 chars)
  const headline = `${metric} ${direction} ${absPct}% in ${period}`;

  // Summary
  const summary = `In ${period}, ${metric} changed from ${fmt(baseline)} to ${fmt(observed)} (${change_pct > 0 ? "+" : ""}${change_pct}%). Analysis of ${facts.data_quality.rows} rows identified ${top_segments.length} contributing segments.`;

  // Hypotheses
  const hypotheses = [];

  // Hypothesis 1: Top segment (supported)
  if (top_segments.length > 0) {
    const top = top_segments[0];
    hypotheses.push({
      title: `${top.dimension}: ${top.value}`,
      reasoning: `This segment contributed ${Math.abs(top.contribution_pct)}% of the total change, with a ${top.change_pct > 0 ? "+" : ""}${top.change_pct}% shift in this period.`,
      confidence: "supported" as const,
      evidence_keys: [
        `top_segments[0].contribution_pct`,
        `top_segments[0].change_pct`,
      ],
    });
  }

  // Hypothesis 2: External factors (needs validation)
  hypotheses.push({
    title: "Potential external factors",
    reasoning: `Changes of this magnitude may reflect campaign timing, seasonality, or market shifts that warrant further investigation beyond the data.`,
    confidence: "needs_validation" as const,
    evidence_keys: ["change_pct", "period"],
  });

  // Next experiment
  let next_experiment: string;
  if (top_segments.length > 0) {
    const top = top_segments[0];
    next_experiment = `Drill into ${top.dimension} cohorts during ${period} to isolate root cause and validate observed ${top.change_pct}% shift.`;
  } else {
    next_experiment = `Collect additional contextual data for ${period} to understand the ${change_pct}% change in ${metric}.`;
  }

  return {
    headline,
    summary,
    hypotheses,
    next_experiment,
  };
}
