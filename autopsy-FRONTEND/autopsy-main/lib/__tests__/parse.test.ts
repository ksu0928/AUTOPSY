/**
 * Tests for CSV parsing
 */

import { describe, it, expect } from "vitest";
import { parseCsv } from "../parse";

describe("parseCsv", () => {
  it("should parse valid CSV with headers", () => {
    const csv = `name,age,city
Alice,30,NYC
Bob,25,LA`;

    const result = parseCsv(csv);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ name: "Alice", age: 30, city: "NYC" });
    expect(result.errors).toHaveLength(0);
  });

  it("should handle thousands separators", () => {
    const csv = `metric,value
Revenue,"1,234"
Users,"10,000"`;

    const result = parseCsv(csv);

    expect(result.rows[0].value).toBe(1234);
    expect(result.rows[1].value).toBe(10000);
  });

  it("should skip empty rows", () => {
    const csv = `a,b

1,2

3,4`;

    const result = parseCsv(csv);

    expect(result.rows).toHaveLength(2);
  });

  it("should reject oversized files", () => {
    // Create ~6MB file (exceeds 5MB limit)
    const largeText = "a,b\n" + "1,2\n".repeat(1500000); // 1.5M rows × 4 bytes = 6MB

    const result = parseCsv(largeText);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("SIZE_EXCEEDED");
    expect(result.rows).toHaveLength(0);
  });

  it("should calculate missing percentage", () => {
    const csv = `a,b,c
1,,3
,,
4,5,6`;

    const result = parseCsv(csv);

    expect(result.missingPct).toBeGreaterThan(0);
    expect(result.missingPct).toBeLessThanOrEqual(100);
  });

  it("should trim headers and values", () => {
    const csv = `  name  ,  age  
  Alice  ,  30  `;

    const result = parseCsv(csv);

    expect(result.rows[0]).toEqual({ name: "Alice", age: 30 });
  });
});
