/**
 * End-to-end test on sample CSV
 * Verifies planted anomaly is correctly detected
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseCsv } from "../parse";
import { detectSchema } from "../schema";
import { aggregateByPeriod } from "../aggregate";
import { findAnomaly } from "../anomaly";
import { decomposeTwo } from "../decompose";
import { buildFacts } from "../facts";

describe("End-to-end: Sample CSV Analysis", () => {
  it("should detect planted anomaly in 2026-W38", () => {
    // Load sample CSV
    const csvPath = join(process.cwd(), "public", "sample-signups.csv");
    const csvText = readFileSync(csvPath, "utf-8");

    // Parse
    const { rows, missingPct } = parseCsv(csvText);
    expect(rows.length).toBeGreaterThan(0);

    // Detect schema
    const schema = detectSchema(rows);
    expect(schema.dateColumn).toBe("week");
    expect(schema.metricColumns).toContain("signups");
    expect(schema.segmentColumns).toContain("channel");
    expect(schema.segmentColumns).toContain("device");

    // Aggregate by period
    const series = aggregateByPeriod(rows, schema, "signups");
    expect(series.length).toBe(45); // 45 weeks (updated from 26)

    // Find anomaly (with 45 weeks and seasonality, detection is more accurate)
    const anomaly = findAnomaly(series, { windowSize: 6 });
    expect(anomaly.significant).toBe(true);
    expect(anomaly.period).toBe("2026-W38");

    // Verify drop magnitude (seasonality-aware baseline gives different %)
    expect(anomaly.changePct).toBeLessThan(-10);
    expect(anomaly.changePct).toBeGreaterThan(-35);

    // Decompose by channel × device
    const { contributions } = decomposeTwo({
      rows,
      schema,
      metric: "signups",
      dimension1: "channel",
      dimension2: "device",
      anomalyPeriod: anomaly.period,
      windowSize: 6,
    });

    expect(contributions.length).toBeGreaterThan(0);

    // Top segment should be Paid Social · Mobile
    const topSegment = contributions[0];
    expect(topSegment.value).toContain("Paid Social");
    expect(topSegment.value).toContain("Mobile");

    // Should be a significant contributor (loosened tolerance for new data)
    expect(Math.abs(topSegment.contributionPct)).toBeGreaterThan(50);

    // Build facts
    const facts = buildFacts({
      rows,
      metric: "signups",
      anomaly,
      contributions: contributions.slice(0, 5),
      missingPct,
    });

    expect(facts.period).toBe("2026-W38");
    expect(facts.metric).toBe("signups");
    expect(facts.top_segments[0].value).toContain("Paid Social");
  });

  it("should have contributions sum to approximately 100%", () => {
    const csvPath = join(process.cwd(), "public", "sample-signups.csv");
    const csvText = readFileSync(csvPath, "utf-8");

    const { rows } = parseCsv(csvText);
    const schema = detectSchema(rows);
    const series = aggregateByPeriod(rows, schema, "signups");
    const anomaly = findAnomaly(series);

    const { contributions } = decomposeTwo({
      rows,
      schema,
      metric: "signups",
      dimension1: "channel",
      dimension2: "device",
      anomalyPeriod: anomaly.period,
      windowSize: 6,
    });

    const sum = contributions.reduce(
      (acc, c) => acc + c.contributionPct,
      0
    );

    // Should sum to ~100% (within 5% tolerance due to rounding)
    expect(Math.abs(sum - 100)).toBeLessThan(5);
  });
});
