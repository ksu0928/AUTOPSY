/**
 * Tests for autopsy validation
 */

import { describe, it, expect } from "vitest";
import { autopsySchema, numbersAreGrounded } from "../validate";
import type { Autopsy, Facts } from "../types";

describe("autopsySchema", () => {
  it("should validate valid autopsy", () => {
    const autopsy: Autopsy = {
      headline: "Signups fell 27.4% in 2026-W38",
      summary: "In 2026-W38, signups dropped from 1840 to 1336.",
      hypotheses: [
        {
          title: "Paid Social · Mobile decline",
          reasoning: "This segment contributed 61% of the drop.",
          confidence: "supported",
          evidence_keys: ["top_segments[0].contribution_pct"],
        },
        {
          title: "External factors",
          reasoning: "May reflect seasonality.",
          confidence: "needs_validation",
          evidence_keys: ["change_pct"],
        },
      ],
      next_experiment: "Drill into Paid Social cohorts.",
    };

    expect(() => autopsySchema.parse(autopsy)).not.toThrow();
  });

  it("should reject headline over 120 chars", () => {
    const autopsy = {
      headline: "A".repeat(121),
      summary: "Summary",
      hypotheses: [
        {
          title: "Test",
          reasoning: "Reasoning",
          confidence: "supported",
          evidence_keys: [],
        },
        {
          title: "Test2",
          reasoning: "Reasoning2",
          confidence: "needs_validation",
          evidence_keys: [],
        },
      ],
      next_experiment: "Experiment",
    };

    expect(() => autopsySchema.parse(autopsy)).toThrow();
  });

  it("should require 2-3 hypotheses", () => {
    const autopsy = {
      headline: "Test",
      summary: "Summary",
      hypotheses: [
        {
          title: "Only one",
          reasoning: "Reasoning",
          confidence: "supported",
          evidence_keys: [],
        },
      ],
      next_experiment: "Experiment",
    };

    expect(() => autopsySchema.parse(autopsy)).toThrow();
  });
});

describe("numbersAreGrounded", () => {
  const facts: Facts = {
    metric: "signups",
    period: "2026-W38",
    change_pct: 27.4,
    baseline: 1840,
    observed: 1336,
    top_segments: [
      {
        dimension: "channel · device",
        value: "Paid Social · Mobile",
        contribution_pct: 61.2,
        change_pct: -52.0,
      },
    ],
    data_quality: {
      rows: 208,
      missing_pct: 0.0,
    },
  };

  const autopsy: Autopsy = {
    headline: "Signups fell 27.4% in 2026-W38",
    summary: "From 1840 to 1336 signups.",
    hypotheses: [
      {
        title: "Segment",
        reasoning: "Contributed 61.2% with -52% change.",
        confidence: "supported",
        evidence_keys: [],
      },
      {
        title: "External",
        reasoning: "Week 38 shows anomaly.",
        confidence: "needs_validation",
        evidence_keys: [],
      },
    ],
    next_experiment: "Analyze 208 rows.",
  };

  it("should pass when all numbers are grounded", () => {
    const offending = numbersAreGrounded(autopsy, facts);
    expect(offending).toHaveLength(0);
  });

  it("should fail with invented number", () => {
    const badAutopsy = {
      ...autopsy,
      summary: "From 1840 to 1336, with 43% attributed to marketing.",
    };

    const offending = numbersAreGrounded(badAutopsy, facts);
    expect(offending.length).toBeGreaterThan(0);
    expect(offending).toContain("43%");
  });

  it("should allow rounded variants", () => {
    const roundedAutopsy = {
      ...autopsy,
      headline: "Signups fell 27% in week 38", // 27.4 rounded
    };

    const offending = numbersAreGrounded(roundedAutopsy, facts);
    expect(offending).toHaveLength(0);
  });

  it("should allow absolute values", () => {
    const absAutopsy = {
      ...autopsy,
      summary: "Absolute change: 52%", // |-52.0|
    };

    const offending = numbersAreGrounded(absAutopsy, facts);
    expect(offending).toHaveLength(0);
  });

  it("should allow positive sign prefix", () => {
    const posAutopsy = {
      ...autopsy,
      summary: "Change of +27.4% observed",
    };

    const offending = numbersAreGrounded(posAutopsy, facts);
    expect(offending).toHaveLength(0);
  });

  it("should allow floor/ceil variants", () => {
    const floorCeilAutopsy = {
      ...autopsy,
      headline: "Signups fell 27% in 2026-W38", // floor(27.4)
      summary: "From 1840 to 1336, roughly 28% drop", // ceil(27.4)
    };

    const offending = numbersAreGrounded(floorCeilAutopsy, facts);
    expect(offending).toHaveLength(0);
  });

  it("should extract numbers from period strings", () => {
    const periodAutopsy = {
      ...autopsy,
      summary: "In week 38 of 2026, signups dropped", // 38 from "2026-W38"
    };

    const offending = numbersAreGrounded(periodAutopsy, facts);
    expect(offending).toHaveLength(0);
  });

  it("should handle multiple offending numbers", () => {
    const badAutopsy = {
      ...autopsy,
      summary: "From 1840 to 1336, with 43% from one segment and 19% from another.",
    };

    const offending = numbersAreGrounded(badAutopsy, facts);
    expect(offending.length).toBeGreaterThan(1);
    expect(offending).toContain("43%");
    expect(offending).toContain("19%");
  });

  it("should use adaptive tolerance for large numbers", () => {
    const largeFacts: Facts = {
      ...facts,
      baseline: 10000,
      observed: 12000,
    };

    const largeAutopsy = {
      ...autopsy,
      summary: "From 10001 to 12001 signups", // Within 0.5% tolerance
    };

    const offending = numbersAreGrounded(largeAutopsy, largeFacts);
    expect(offending).toHaveLength(0);
  });
});
