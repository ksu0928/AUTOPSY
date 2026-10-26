/**
 * CSV parsing with size validation and numeric coercion
 * Pure function, no side effects, works in browser and Node
 */

import Papa from "papaparse";
import type { Row, ParseResult, ParseError } from "./types";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Parse CSV text into typed rows with quality metrics
 * @param text CSV text content
 * @returns Parsed rows, missing value percentage, and errors
 */
export function parseCsv(text: string): ParseResult {
  const errors: ParseError[] = [];

  // Size check
  if (text.length > MAX_FILE_SIZE) {
    errors.push({
      code: "SIZE_EXCEEDED",
      message: `File size ${text.length} bytes exceeds limit of ${MAX_FILE_SIZE} bytes`,
    });
    return { rows: [], missingPct: 0, errors };
  }

  // Parse with PapaParse
  const parseResult = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // We'll handle typing ourselves
  });

  if (parseResult.errors.length > 0) {
    parseResult.errors.forEach((err) => {
      errors.push({
        code: "PARSE_FAILED",
        message: err.message,
        row: err.row,
      });
    });
  }

  // Process rows
  const rows: Row[] = [];
  let totalCells = 0;
  let missingCells = 0;

  for (const rawRow of parseResult.data as Record<string, unknown>[]) {
    const row: Row = {};
    let allEmpty = true;

    for (let [key, value] of Object.entries(rawRow)) {
      // Trim header
      key = key.trim();

      // Count cells
      totalCells++;

      // Handle null/undefined
      if (value === null || value === undefined || value === "") {
        row[key] = null;
        missingCells++;
        continue;
      }

      // Trim string values
      if (typeof value === "string") {
        value = value.trim();
      }

      // Try numeric coercion
      const numeric = coerceNumeric(value);
      if (numeric !== null) {
        row[key] = numeric;
        allEmpty = false;
      } else if (typeof value === "string" && value !== "") {
        row[key] = value;
        allEmpty = false;
      } else {
        row[key] = null;
        missingCells++;
      }
    }

    // Skip fully empty rows
    if (!allEmpty) {
      rows.push(row);
    }
  }

  const missingPct = totalCells > 0 ? (missingCells / totalCells) * 100 : 0;

  return { rows, missingPct, errors };
}

/**
 * Coerce a value to number, stripping thousands separators
 * @param value Value to coerce
 * @returns Number or null if not numeric
 */
function coerceNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  // Strip thousands separators (commas and spaces)
  const cleaned = value.replace(/[,\s]/g, "");

  // Try parsing
  const num = Number(cleaned);
  if (!isNaN(num) && isFinite(num)) {
    return num;
  }

  return null;
}
