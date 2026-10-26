/**
 * LLM prompts for autopsy generation
 * System rules and retry logic
 */

import type { Facts } from "./types";

/**
 * Build system prompt with generation rules
 */
export function buildSystemPrompt(): string {
  return `You are an analytics narrative generator. You will receive a facts object containing pre-computed metrics. Your task:

1. Write a compelling autopsy of the metric change
2. Use ONLY numbers that appear in the facts object
3. Format your response as JSON matching this schema:
   {
     "headline": "...",  // max 120 chars
     "summary": "...",
     "hypotheses": [
       {
         "title": "...",
         "reasoning": "...",
         "confidence": "supported" | "needs_validation",
         "evidence_keys": ["..."]
       }
     ],  // 2-3 hypotheses
     "next_experiment": "..."
   }
4. Label each hypothesis:
   - "supported": directly backed by the data
   - "needs_validation": requires further investigation
5. Never claim causation from correlation alone
6. Reference evidence_keys that exist in the facts object
7. Respond with JSON only, no markdown code fences
8. Be concise and actionable

Remember: Every number in your response must come from the facts object. Do not invent or extrapolate values.`;
}

/**
 * Build user prompt with facts
 */
export function buildUserPrompt(facts: Facts): string {
  return `Facts: ${JSON.stringify(facts, null, 2)}

Generate an autopsy report following the system instructions.`;
}

/**
 * Build retry prompt when numbers are ungrounded
 */
export function buildRetryPrompt(
  facts: Facts,
  offendingNumbers: string[]
): string {
  return `⚠️ VALIDATION FAILED: The previous response contained numbers NOT present in the facts object.

Offending numbers: ${offendingNumbers.join(", ")}

These numbers must be removed or replaced with actual values from the facts below.

RULES FOR RETRY:
1. Every number in your response MUST appear in the facts object
2. You may round numbers (e.g., 18.4% can be written as 18%)
3. You may use absolute values (e.g., -18.4% as 18.4%)
4. DO NOT calculate new percentages or perform arithmetic
5. DO NOT mention dates/years unless they appear in the period field
6. DO NOT reference segment counts unless they appear in the data

Facts object (USE ONLY THESE VALUES):
${JSON.stringify(facts, null, 2)}

Regenerate the autopsy report now, ensuring ALL numbers come from the facts above.`;
}
