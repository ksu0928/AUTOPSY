/**
 * Tests for schema detection
 */

import { describe, it, expect } from "vitest";
import { detectSchema } from "../schema";
import type { Row } from "../types";

describe("detectSchema", () => {
  it("should detect date column from ISO week format", () => {
    const rows: Row[] = [
      { week: "2026-W01", signups: 100 },
      { week: "2026-W02", signups: 105 },
    ];

    const schema = detectSchema(rows);

    expect(schema.dateColumn).toBe("week");
    expect(schema.confidence.week).toBe("high");
  });

  it("should detect numeric metric columns", () => {
    const rows: Row[] = [
      { date: "2026-01-01", revenue: 1000, signups: 50, city: "NYC" },
      { date: "2026-01-02", revenue: 1200, signups: 60, city: "LA" },
    ];

    const schema = detectSchema(rows);

    expect(schema.metricColumns).toContain("revenue");
    expect(schema.metricColumns).toContain("signups");
    expect(schema.metricColumns).not.toContain("city");
  });

  it("should detect segment (string) columns", () => {
    const rows: Row[] = [
      { week: "2026-W01", channel: "Organic", device: "Mobile", signups: 100 },
      { week: "2026-W01", channel: "Paid", device: "Desktop", signups: 150 },
    ];

    const schema = detectSchema(rows);

    expect(schema.segmentColumns).toContain("channel");
    expect(schema.segmentColumns).toContain("device");
    expect(schema.segmentColumns).not.toContain("week");
    expect(schema.segmentColumns).not.toContain("signups");
  });

  it("should handle low-confidence date detection", () => {
    const rows: Row[] = [
      { id: "1", value: 100 },
      { id: "2", value: 200 },
    ];

    const schema = detectSchema(rows);

    // No clear date column, should have empty or low confidence
    if (schema.dateColumn) {
      expect(schema.confidence[schema.dateColumn]).toBe("low");
    }
  });

  it("should handle ambiguous schema with mixed types", () => {
    const rows: Row[] = [
      { col1: "2026-01", col2: 100, col3: "A" },
      { col1: "2026-02", col2: "mixed", col3: "B" },
    ];

    const schema = detectSchema(rows);

    // col2 has mixed types, won't be detected as metric
    // col3 should be detected as segment
    expect(schema.segmentColumns).toContain("col3");
  });

  it("should detect date-like columns", () => {
    const rows: Row[] = [
      { date: "2026-01-01", week: "2026-W01", signups: 100 },
      { date: "2026-01-08", week: "2026-W02", signups: 105 },
    ];

    const schema = detectSchema(rows);

    // Should detect at least one date column
    expect(schema.dateColumn).toBeTruthy();
    expect(["date", "week"]).toContain(schema.dateColumn);
  });
});
