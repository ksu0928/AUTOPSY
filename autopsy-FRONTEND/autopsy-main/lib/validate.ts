/**
 * Autopsy validation - schema and number grounding
 * Ensures LLM only uses facts values
 */

import { z } from "zod";
import { buildEvidenceIndex } from "./facts";
import type { Autopsy, Facts, EvidenceIndex } from "./types";

/**
 * Zod schema for autopsy structure
 */
export const autopsySchema = z
  .object({
    headline: z.string().max(120),
    summary: z.string().min(1),
    hypotheses: z
      .array(
        z.object({
          title: z.string().min(1),
          reasoning: z.string().min(1),
          confidence: z.enum(["supported", "needs_validation"]),
          evidence_keys: z.array(z.string()),
        })
      )
      .min(2)
      .max(3),
    next_experiment: z.string().min(1),
  })
  .strict();

/**
 * Check if all numbers in autopsy are grounded in facts
 * @param autopsy Generated autopsy
 * @param facts Source facts
 * @returns Array of offending numbers (empty if all grounded)
 */
export function numbersAreGrounded(autopsy: Autopsy, facts: Facts): string[] {
  const evidence = buildEvidenceIndex(facts);
  const allowedValues = buildAllowedValues(evidence);

  // Extract all text from autopsy
  const texts = [
    autopsy.headline,
    autopsy.summary,
    ...autopsy.hypotheses.map((h) => h.title),
    ...autopsy.hypotheses.map((h) => h.reasoning),
    autopsy.next_experiment,
  ];

  const offending: Set<string> = new Set();

  for (const text of texts) {
    const numbers = extractNumbers(text);

    for (const numStr of numbers) {
      const value = parseNumberString(numStr);

      // Check if this number is allowed
      if (!isAllowed(value, allowedValues)) {
        offending.add(numStr);
      }
    }
  }

  return Array.from(offending);
}

/**
 * Extract all numbers from text
 * Handles: percentages, commas, decimals, negative numbers, ranges
 * Uses word boundaries to avoid extracting substring numbers
 */
function extractNumbers(text: string): string[] {
  // Match: optional +/-, digits with optional commas, optional decimal, optional %
  // Negative lookbehind/lookahead to ensure we match complete numbers
  const regex = /(?<!\d)[+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?(?!\d)/g;
  return Array.from(text.matchAll(regex)).map((m) => m[0]);
}

/**
 * Parse number string to numeric value
 */
function parseNumberString(str: string): number {
  // Remove commas, +, and %
  let cleaned = str.replace(/[,+]/g, "");
  const isPct = cleaned.endsWith("%");
  cleaned = cleaned.replace(/%/g, "");

  const value = parseFloat(cleaned);
  return isNaN(value) ? 0 : value;
}

/**
 * Build set of allowed values from evidence
 * Includes rounded variants and common transformations
 */
function buildAllowedValues(evidence: EvidenceIndex): Set<number> {
  const allowed = new Set<number>();

  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === "number") {
      // Exact value
      allowed.add(value);

      // Absolute value
      allowed.add(Math.abs(value));

      // Rounded variants (0, 1, 2 decimal places)
      allowed.add(Math.round(value));
      allowed.add(Math.round(value * 10) / 10);
      allowed.add(Math.round(value * 100) / 100);

      // Negative
      allowed.add(-value);

      // Floor/ceil for ranges
      allowed.add(Math.floor(value));
      allowed.add(Math.ceil(value));
      allowed.add(Math.floor(Math.abs(value)));
      allowed.add(Math.ceil(Math.abs(value)));
    }

    // Extract numbers from strings (period, dimensions, values)
    if (typeof value === "string") {
      const nums = extractNumbers(value);
      nums.forEach((numStr) => {
        const num = parseNumberString(numStr);
        allowed.add(num);
        allowed.add(Math.abs(num));
        allowed.add(Math.round(num));
      });
    }
  }

  return allowed;
}

/**
 * Check if a value is allowed (within rounding tolerance)
 * Tolerates small rounding differences
 */
function isAllowed(value: number, allowedValues: Set<number>): boolean {
  // Larger tolerance for larger numbers (0.5% or 0.1, whichever is larger)
  const tolerance = Math.max(0.1, Math.abs(value) * 0.005);

  for (const allowed of allowedValues) {
    if (Math.abs(value - allowed) <= tolerance) {
      return true;
    }
  }

  // Also allow common whole numbers near the value
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) <= 0.5 && allowedValues.has(rounded)) {
    return true;
  }

  return false;
}
