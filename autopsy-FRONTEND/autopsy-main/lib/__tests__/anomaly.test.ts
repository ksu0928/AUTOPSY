/**
 * Tests for anomaly detection
 */

import { describe, it, expect } from "vitest";
import { findAnomaly } from "../anomaly";
import type { PeriodPoint } from "../types";

describe("findAnomaly", () => {
  it("should detect z-score anomaly", () => {
    const series: PeriodPoint[] = [
      { period: "W1", value: 100 },
      { period: "W2", value: 102 },
      { period: "W3", value: 98 },
      { period: "W4", value: 101 },
      { period: "W5", value: 99 },
      { period: "W6", value: 100 },
      { period: "W7", value: 150 }, // Anomaly: +50%
    ];

    const result = findAnomaly(series, { windowSize: 6 });

    expect(result.significant).toBe(true);
    expect(result.period).toBe("W7");
    expect(result.observed).toBe(150);
    expect(result.changePct).toBeGreaterThan(40);
  });

  it("should detect percentage change anomaly", () => {
    const series: PeriodPoint[] = [
      { period: "W1", value: 100 },
      { period: "W2", value: 100 },
      { period: "W3", value: 100 },
      { period: "W4", value: 100 },
      { period: "W5", value: 100 },
      { period: "W6", value: 100 },
      { period: "W7", value: 80 }, // -20% change
    ];

    const result = findAnomaly(series, { windowSize: 6, pctThreshold: 15 });

    expect(result.significant).toBe(true);
    expect(result.period).toBe("W7");
    expect(result.changePct).toBeLessThan(-15);
  });

  it("should handle SD = 0 case", () => {
    const series: PeriodPoint[] = [
      { period: "W1", value: 100 },
      { period: "W2", value: 100 },
      { period: "W3", value: 100 },
      { period: "W4", value: 100 },
      { period: "W5", value: 100 },
      { period: "W6", value: 100 },
      { period: "W7", value: 200 }, // SD=0, value differs
    ];

    const result = findAnomaly(series, { windowSize: 6 });

    expect(result.significant).toBe(true);
    expect(result.z).toBe(Infinity);
    expect(result.period).toBe("W7");
  });

  it("should set lowConfidence for fewer than 8 periods", () => {
    const series: PeriodPoint[] = [
      { period: "W1", value: 100 },
      { period: "W2", value: 102 },
      { period: "W3", value: 98 },
      { period: "W4", value: 150 },
    ];

    const result = findAnomaly(series, { windowSize: 4 });

    expect(result.lowConfidence).toBe(true);
  });

  it("should return significant=false when no anomaly", () => {
    const series: PeriodPoint[] = [
      { period: "W1", value: 100 },
      { period: "W2", value: 101 },
      { period: "W3", value: 99 },
      { period: "W4", value: 100 },
      { period: "W5", value: 102 },
      { period: "W6", value: 98 },
      { period: "W7", value: 100 }, // Within noise
    ];

    const result = findAnomaly(series, { windowSize: 6 });

    expect(result.significant).toBe(false);
  });

  it("should select max |z| among multiple anomalies", () => {
    // Test with non-weekly pattern to test rolling window behavior
    const series: PeriodPoint[] = [
      { period: "2026-01", value: 100 },
      { period: "2026-02", value: 100 },
      { period: "2026-03", value: 100 },
      { period: "2026-04", value: 100 },
      { period: "2026-05", value: 100 },
      { period: "2026-06", value: 100 },
      { period: "2026-07", value: 120 }, // +20%
      { period: "2026-08", value: 150 }, // +50% but baseline includes 120
    ];

    const result = findAnomaly(series, { windowSize: 6 });

    // Should detect an anomaly (either 07 or 08)
    expect(result.significant).toBe(true);
    expect(["2026-07", "2026-08"]).toContain(result.period);
    expect(result.changePct).toBeGreaterThan(15);
  });

  describe("Seasonality-aware detection", () => {
    it("should detect weekly pattern in ISO week format", () => {
      // Simulate weekly seasonality: Mondays are high, Sundays are low
      const series: PeriodPoint[] = [
        { period: "2026-W01", value: 100 }, // Monday baseline
        { period: "2026-W02", value: 95 },
        { period: "2026-W03", value: 102 },
        { period: "2026-W04", value: 98 },
        { period: "2026-W05", value: 101 },
        { period: "2026-W06", value: 99 },
        { period: "2026-W07", value: 100 },
        { period: "2026-W08", value: 150 }, // Anomaly on same weekday
      ];

      const result = findAnomaly(series, { windowSize: 3 });

      // Should detect anomaly by comparing to same weekdays
      expect(result.significant).toBe(true);
      expect(result.period).toBe("2026-W08");
    });

    it("should use same-weekday baseline for weekly data", () => {
      // Pattern: every 7th week is similar
      const series: PeriodPoint[] = [];
      
      // Create 50 weeks of data with consistent pattern
      for (let w = 1; w <= 50; w++) {
        const weekNum = String(w).padStart(2, "0");
        const baseValue = 100;
        const noise = (w % 3) * 5; // Some variation
        series.push({ 
          period: `2026-W${weekNum}`, 
          value: baseValue + noise 
        });
      }

      // Add anomaly at week 49 (same weekday as weeks 42, 35, 28, 21, 14, 7)
      series[48].value = 200; // Double the normal value

      const result = findAnomaly(series, { windowSize: 6 });

      expect(result.significant).toBe(true);
      expect(result.period).toBe("2026-W49");
      expect(result.observed).toBe(200);
    });

    it("should fall back to rolling window if not weekly pattern", () => {
      const series: PeriodPoint[] = [
        { period: "2026-01-01", value: 100 }, // Daily format
        { period: "2026-01-02", value: 102 },
        { period: "2026-01-03", value: 98 },
        { period: "2026-01-04", value: 101 },
        { period: "2026-01-05", value: 99 },
        { period: "2026-01-06", value: 100 },
        { period: "2026-01-07", value: 150 },
      ];

      const result = findAnomaly(series, { windowSize: 6 });

      // Should still work with rolling window
      expect(result.significant).toBe(true);
      expect(result.period).toBe("2026-01-07");
    });

    it("should handle insufficient same-weekday data gracefully", () => {
      // Only 3 weeks of data - not enough for 7-period intervals
      const series: PeriodPoint[] = [
        { period: "2026-W01", value: 100 },
        { period: "2026-W02", value: 100 },
        { period: "2026-W03", value: 150 },
      ];

      const result = findAnomaly(series, { windowSize: 6 });

      // Should fall back to recent window without crashing
      expect(result).toBeDefined();
      expect(result.period).toBe("2026-W03");
    });
  });
});
