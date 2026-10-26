/**
 * POST /api/narrate - Generate autopsy narrative from facts
 * Rate limited, LLM with fallback to template
 */

import { z } from "zod";
import { createLLMAdapter } from "@/lib/llm";
import { buildSystemPrompt, buildUserPrompt, buildRetryPrompt } from "@/lib/prompt";
import { autopsySchema, numbersAreGrounded } from "@/lib/validate";
import { templateAutopsy } from "@/lib/template";
import type { NarrateRequest, NarrateResponse, Facts, Autopsy } from "@/lib/types";

export const runtime = "nodejs";

// ============================================================================
// Rate Limiter (in-memory, best-effort, per-instance only)
// ============================================================================

// Note: This rate limiter uses in-memory state and does not persist across
// serverless function instances or restarts. It provides best-effort rate
// limiting for a single instance but does not guarantee global rate limits
// in multi-instance deployments.
class TokenBucket {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  allow(key: string, limit = 10, windowMs = 60000): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) || { tokens: limit, lastRefill: now };

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const periodsElapsed = Math.floor(elapsed / windowMs);
    if (periodsElapsed > 0) {
      bucket.tokens = Math.min(limit, bucket.tokens + periodsElapsed * limit);
      bucket.lastRefill = now;
    }

    // Check and consume
    if (bucket.tokens > 0) {
      bucket.tokens--;
      this.buckets.set(key, bucket);
      return true;
    }

    return false;
  }
}

const rateLimiter = new TokenBucket();

// ============================================================================
// Request Validation
// ============================================================================

const factsSchema = z
  .object({
    metric: z.string().max(64),
    period: z.string().max(64),
    change_pct: z.number().finite(),
    baseline: z.number().finite(),
    observed: z.number().finite(),
    top_segments: z
      .array(
        z.object({
          dimension: z.string().max(64),
          value: z.string().max(64),
          contribution_pct: z.number().finite(),
          change_pct: z.number().finite(),
        })
      )
      .max(5),
    data_quality: z.object({
      rows: z.number().int().positive(),
      missing_pct: z.number().min(0).max(100),
    }),
  })
  .strict();

const narrateRequestSchema = z
  .object({
    facts: factsSchema,
  })
  .strict();

// ============================================================================
// Handler
// ============================================================================

export async function POST(req: Request): Promise<Response> {
  const startTime = Date.now();

  try {
    // Parse and validate request
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Invalid JSON", "body");
    }

    const validation = narrateRequestSchema.safeParse(body);
    if (!validation.success) {
      const firstError = validation.error.errors[0];
      return errorResponse(
        400,
        firstError.message,
        firstError.path.join(".")
      );
    }

    const { facts } = validation.data;

    // Rate limiting
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimiter.allow(ip)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      });
    }

    // Check LLM configuration
    const provider = process.env.LLM_PROVIDER as "anthropic" | "gemini" | "groq" | undefined;
    const apiKey =
      provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : provider === "gemini"
        ? process.env.GEMINI_API_KEY
        : provider === "groq"
        ? process.env.GROQ_API_KEY
        : undefined;

    // If no LLM configured, return template immediately
    if (!provider || !apiKey) {
      const autopsy = templateAutopsy(facts);
      logRequest(200, Date.now() - startTime, "template");
      return successResponse(autopsy, "template", TEMPLATE_NOTICE);
    }

    // Try LLM generation
    try {
      const adapter = createLLMAdapter(provider, apiKey);
      const autopsy = await generateWithLLM(adapter, facts);
      logRequest(200, Date.now() - startTime, "llm");
      return successResponse(autopsy, "llm");
    } catch (error) {
      // Log error (but not facts)
      console.error("LLM generation failed:", {
        error: (error as Error).message,
        provider,
      });

      // Fallback to template
      const autopsy = templateAutopsy(facts);
      logRequest(200, Date.now() - startTime, "template");
      return successResponse(autopsy, "template", TEMPLATE_NOTICE);
    }
  } catch (error) {
    console.error("Request handler error:", (error as Error).message);
    return errorResponse(500, "Internal server error");
  }
}

// ============================================================================
// LLM Generation
// ============================================================================

const TEMPLATE_NOTICE =
  "This report was generated from a template because the writing service did not respond.";
const LLM_TIMEOUT_MS = 8000;

async function generateWithLLM(
  adapter: ReturnType<typeof createLLMAdapter>,
  facts: Facts
): Promise<Autopsy> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(facts);

  // First attempt
  let responseText = await adapter.generate(
    systemPrompt,
    userPrompt,
    LLM_TIMEOUT_MS
  );
  responseText = stripCodeFences(responseText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Failed to parse LLM response as JSON");
  }

  let autopsy = autopsySchema.parse(parsed);

  // Validate grounded numbers
  let offending = numbersAreGrounded(autopsy, facts);
  if (offending.length > 0) {
    // Retry once
    const retryPrompt = buildRetryPrompt(facts, offending);
    responseText = await adapter.generate(
      systemPrompt,
      retryPrompt,
      LLM_TIMEOUT_MS
    );
    responseText = stripCodeFences(responseText);

    parsed = JSON.parse(responseText);
    autopsy = autopsySchema.parse(parsed);

    // Check again
    offending = numbersAreGrounded(autopsy, facts);
    if (offending.length > 0) {
      throw new Error(`Ungrounded numbers persist: ${offending.join(", ")}`);
    }
  }

  return autopsy;
}

/**
 * Strip markdown code fences from LLM response
 */
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*|\s*```$/gm, "").trim();
}

// ============================================================================
// Response Helpers
// ============================================================================

function successResponse(
  autopsy: Autopsy,
  source: "llm" | "template",
  notice?: string
): Response {
  const body: NarrateResponse = { autopsy, source };
  if (notice) {
    body.notice = notice;
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(
  status: number,
  error: string,
  field?: string
): Response {
  const body = field ? { error, field } : { error };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Log request metadata (never log facts or prompts)
 */
function logRequest(status: number, latency: number, source: string): void {
  console.log(JSON.stringify({ status, latency, source }));
}
