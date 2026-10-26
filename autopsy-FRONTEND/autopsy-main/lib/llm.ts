/**
 * LLM adapter interface and implementations
 * Supports Anthropic and Gemini with timeout handling
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMAdapter, LLMProvider } from "./types";

/**
 * Create LLM adapter for specified provider
 * @param provider Provider name
 * @param apiKey API key
 * @returns Configured adapter
 */
export function createLLMAdapter(
  provider: LLMProvider,
  apiKey: string
): LLMAdapter {
  if (provider === "anthropic") {
    return new AnthropicAdapter(apiKey);
  } else if (provider === "gemini") {
    return new GeminiAdapter(apiKey);
  } else if (provider === "groq") {
    return new GroqAdapter(apiKey);
  }
  throw new Error(`Unknown LLM provider: ${provider}`);
}

/**
 * Anthropic/Claude adapter
 */
class AnthropicAdapter implements LLMAdapter {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    system: string,
    user: string,
    timeout: number
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this.client.messages.create(
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 2000,
          temperature: 0,
          system,
          messages: [{ role: "user", content: user }],
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      const content = response.content[0];
      if (content.type === "text") {
        return content.text;
      }

      throw new Error("Unexpected response type from Anthropic");
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === "AbortError") {
        throw new Error("LLM request timeout");
      }
      throw error;
    }
  }
}

/**
 * Google Gemini adapter
 */
class GeminiAdapter implements LLMAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(
    system: string,
    user: string,
    timeout: number
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${this.apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: system },
            { text: user },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2000,
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error("Unexpected response format from Gemini");
      }

      return text;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === "AbortError") {
        throw new Error("LLM request timeout");
      }
      throw error;
    }
  }
}

/**
 * Groq adapter
 */
class GroqAdapter implements LLMAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(
    system: string,
    user: string,
    timeout: number
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const url = "https://api.groq.com/openai/v1/chat/completions";

    const requestBody = {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 2000,
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;

      if (!text) {
        throw new Error("Unexpected response format from Groq");
      }

      return text;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === "AbortError") {
        throw new Error("LLM request timeout");
      }
      throw error;
    }
  }
}
