/**
 * Generate messy, realistic sample CSV with planted anomalies
 * Seeded PRNG for reproducibility
 * Features: missing values, noise, multiple scenarios, seasonality
 */

import seedrandom from "seedrandom";
import { writeFileSync } from "fs";
import { join } from "path";

const SEED = "metric-autopsy-hackathon-2026";
const rng = seedrandom(SEED);

const channels = ["Organic", "Paid Social", "Email", "Referral"];
const devices = ["Mobile", "Desktop"];

// Baseline signups per segment (total ≈1,840)
const baseline: Record<string, number> = {
  "Organic · Mobile": 320,
  "Organic · Desktop": 185,
  "Paid Social · Mobile": 593,
  "Paid Social · Desktop": 287,
  "Email · Mobile": 198,
  "Email · Desktop": 142,
  "Referral · Mobile": 86,
  "Referral · Desktop": 29,
};

// Add realistic noise (±3-8%)
function noise(magnitude = 0.06): number {
  return 1 + (rng() - 0.5) * magnitude;
}

// Simulate weekly seasonality (Monday high, Sunday low)
function weeklyPattern(weekNum: number): number {
  // Simple sine wave with 7-week period
  return 1 + Math.sin((weekNum * 2 * Math.PI) / 7) * 0.05;
}

// Occasionally drop a data point (1% chance)
function shouldDrop(): boolean {
  return rng() < 0.01;
}

// Generate CSV rows with messy, realistic data
const rows: string[] = ["week,channel,device,signups"];

for (let w = 1; w <= 45; w++) {
  const period = `2026-W${w.toString().padStart(2, "0")}`;
  const seasonality = weeklyPattern(w);

  for (const channel of channels) {
    for (const device of devices) {
      const key = `${channel} · ${device}`;
      let base = baseline[key] || 0;

      // Apply seasonality
      base = base * seasonality;

      // Apply noise
      let signups = Math.round(base * noise(0.08));

      // === PLANTED ANOMALIES ===

      // Anomaly 1: Big drop in Paid Social · Mobile at W38 (campaign pause)
      if (w === 38 && channel === "Paid Social" && device === "Mobile") {
        signups = Math.round(285 + (rng() - 0.5) * 15); // ~52% drop
      }

      // Anomaly 2: Spike in Email · Mobile at W42 (successful newsletter)
      if (w === 42 && channel === "Email" && device === "Mobile") {
        signups = Math.round(395 + (rng() - 0.5) * 20); // ~100% spike
      }

      // Anomaly 3: Gradual decline in Organic · Desktop (weeks 35-45)
      if (w >= 35 && channel === "Organic" && device === "Desktop") {
        const declineRate = (w - 34) * 0.03; // 3% per week
        signups = Math.round(signups * (1 - declineRate));
      }

      // Anomaly 4: Referral spike at W30 (viral post)
      if (w === 30 && channel === "Referral") {
        signups = Math.round(signups * 2.4); // 140% increase
      }

      // Missing values (create messiness)
      if (shouldDrop()) {
        continue; // Skip this row (simulate missing data)
      }

      rows.push(`${period},${channel},${device},${signups}`);
    }
  }
}

// Write main sample file
const mainPath = join(process.cwd(), "public", "sample-signups.csv");
writeFileSync(mainPath, rows.join("\n"), "utf-8");

console.log(`✓ Generated ${mainPath}`);
console.log(`  ${rows.length - 1} rows across 45 weeks`);
console.log(`  Missing values: ~1% dropped randomly`);
console.log(`  Planted anomalies:`);
console.log(`    1. W38: Paid Social · Mobile drops ~52% (campaign pause)`);
console.log(`    2. W42: Email · Mobile spikes ~100% (newsletter success)`);
console.log(`    3. W35-45: Organic · Desktop gradual decline ~3%/week`);
console.log(`    4. W30: Referral spike ~140% (viral moment)`);

// === GENERATE ADDITIONAL SCENARIO SAMPLES ===

// Scenario 1: Clean spike for quick demo
const spikeRows: string[] = ["week,channel,device,signups"];
for (let w = 20; w <= 30; w++) {
  const period = `2026-W${w.toString().padStart(2, "0")}`;
  for (const channel of channels) {
    for (const device of devices) {
      const key = `${channel} · ${device}`;
      let signups = Math.round((baseline[key] || 0) * noise(0.04));
      
      // Spike at W28 in Paid Social · Mobile
      if (w === 28 && channel === "Paid Social" && device === "Mobile") {
        signups = Math.round(890); // +50%
      }
      
      spikeRows.push(`${period},${channel},${device},${signups}`);
    }
  }
}

const spikePath = join(process.cwd(), "public", "sample-spike.csv");
writeFileSync(spikePath, spikeRows.join("\n"), "utf-8");
console.log(`\n✓ Generated ${spikePath} (clean spike scenario)`);

// Scenario 2: Multi-segment drop for complex analysis
const dropRows: string[] = ["week,channel,device,signups"];
for (let w = 15; w <= 25; w++) {
  const period = `2026-W${w.toString().padStart(2, "0")}`;
  for (const channel of channels) {
    for (const device of devices) {
      const key = `${channel} · ${device}`;
      let signups = Math.round((baseline[key] || 0) * noise(0.04));
      
      // Multiple segments drop at W23
      if (w === 23) {
        if (channel === "Paid Social") {
          signups = Math.round(signups * 0.65); // -35%
        }
        if (channel === "Email" && device === "Mobile") {
          signups = Math.round(signups * 0.55); // -45%
        }
      }
      
      dropRows.push(`${period},${channel},${device},${signups}`);
    }
  }
}

const dropPath = join(process.cwd(), "public", "sample-multi-drop.csv");
writeFileSync(dropPath, dropRows.join("\n"), "utf-8");
console.log(`✓ Generated ${dropPath} (multi-segment drop scenario)`);

console.log(`\n📊 All sample files ready for demo!`);

