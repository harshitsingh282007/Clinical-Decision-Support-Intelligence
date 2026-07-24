// Pipeline Router - routes AI calls to Groq or DxGPT based on stage
// Groq stages: ocr_cleanup, entity_extract, prescription_parse, lab_structure, intake_generate
// DxGPT stages: correlate, diagnose, confidence_score, report_generate, chat_reason

import { logger } from "./lib/logger.js";
import { errorMessage } from "./lib/errors.js";

function getEnvSecure(key: string): string | undefined {
  const val = process.env[key];
  if (!val) return undefined;
  // Trim spaces, newlines, and remove leading/trailing quotes or line separators
  return val.trim().replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, "").replace(/^["']|["']$/g, "");
}

const GEMINI_STAGES = new Set([
  "ocr_cleanup",
  "entity_extract",
  "prescription_parse",
  "lab_structure",
  "intake_generate",
]);

const DXGPT_STAGES = new Set([
  "correlate",
  "diagnose",
  "confidence_score",
  "report_generate",
  "chat_reason",
]);

export type PipelineStage =
  | "ocr_cleanup"
  | "entity_extract"
  | "prescription_parse"
  | "lab_structure"
  | "intake_generate"
  | "correlate"
  | "diagnose"
  | "confidence_score"
  | "report_generate"
  | "chat_reason";

interface AIResponse {
  content: string;
  error?: string;
  timedOut?: boolean;
  partial?: boolean;
}

type ChatMessage = { role: string; content: string };

const TIMEOUT_MS = 45_000;
const STREAM_READ_IDLE_MS = 30_000;

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODEL = "gemini-2.5-flash";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("AI call timed out")), ms);
    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

// ── Shared request-building helpers ─────────────────────────────────────────

/** Language directive appended to the system prompt. The chat pipeline uses a
 *  shorter variant than the structured (non-streaming) calls. */
function languageInstruction(language: string, variant: "full" | "short" = "full"): string {
  if (language === "English") return "";
  return variant === "short"
    ? `\n\nRespond in ${language}.`
    : `\n\nRespond in ${language}. The user's input may also be in ${language}.`;
}

function geminiHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
}

function dxgptHeaders(apiKey: string): Record<string, string> {
  return { ...geminiHeaders(apiKey), "x-api-key": apiKey };
}

/** Prepend the (language-augmented) system prompt to the message list. */
function withSystemPrompt(systemPrompt: string, langInstruction: string, rest: ChatMessage[]): ChatMessage[] {
  return [{ role: "system", content: systemPrompt + langInstruction }, ...rest];
}

/** Pull the assistant text out of an OpenAI-style (or DxGPT) chat response. */
function extractChatContent(data: unknown): string {
  const d = data as { choices?: Array<{ message?: { content?: string } }>; content?: string };
  return d.choices?.[0]?.message?.content ?? (d.content as string) ?? "";
}

/** Parse a Server-Sent-Events completion stream into content tokens. */
async function* parseSSETokens(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await withTimeout(reader.read(), STREAM_READ_IDLE_MS);
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta: { content?: string } }> };
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch { /* skip */ }
      }
    }
  }
}

const GEMINI_FALLBACK_MODELS = ["gemini-1.5-pro", "gemini-1.5-flash"];

async function callGeminiChat(
  prompt: string,
  systemPrompt: string,
  language: string,
  jsonMode: boolean
): Promise<AIResponse> {
  const apiKey = getEnvSecure("GEMINI_API_KEY");
  if (!apiKey) {
    return { content: "", error: "GEMINI_API_KEY not configured", partial: true };
  }

  const modelsToTry = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  let lastError = "";
  let lastStatus = 500;

  for (const model of modelsToTry) {
    try {
      const res = await withTimeout(
        fetch(GEMINI_URL, {
          method: "POST",
          headers: geminiHeaders(apiKey),
          body: JSON.stringify({
            model: model,
            messages: withSystemPrompt(systemPrompt, languageInstruction(language), [
              { role: "user", content: prompt },
            ]),
            temperature: jsonMode ? 0.1 : 0.3,
            max_tokens: 4096,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          }),
        }),
        TIMEOUT_MS
      );
      
      if (res.ok) {
        return { content: extractChatContent(await res.json()) };
      }
      
      const err = await res.text();
      lastError = err;
      lastStatus = res.status;
      logger.warn({ model, status: res.status, err }, "Gemini model failed, trying next");
      
      // If unauthorized (401), no point in trying other models
      if (res.status === 401) {
        break;
      }
    } catch (e: unknown) {
      const msg = errorMessage(e);
      logger.warn({ model, msg }, "Gemini model threw exception, trying next");
      lastError = msg;
    }
  }

  const finalErr = `Gemini API error: ${lastStatus} ${lastError}`;
  if (jsonMode) {
    logger.error({ finalErr }, "All Gemini models failed");
    return { content: "", error: finalErr, partial: true };
  }
  return { content: "", error: finalErr, partial: true };
}

async function callDxGPT(prompt: string, systemPrompt: string, language = "English", isFallback = false): Promise<AIResponse> {
  const apiKey = getEnvSecure("DXGPT_API_KEY");
  const endpoint = getEnvSecure("DXGPT_ENDPOINT");

  // Fall back to Gemini if DxGPT not configured
  if (!apiKey || !endpoint) {
    logger.warn("DxGPT not configured (missing key or endpoint)");
    if (isFallback) return { content: "", error: "DxGPT fallback failed: DXGPT_ENDPOINT or DXGPT_API_KEY missing", partial: true };
    return callGeminiChat(prompt, systemPrompt, language, false);
  }

  try {
    const res = await withTimeout(
      fetch(endpoint, {
        method: "POST",
        headers: dxgptHeaders(apiKey),
        body: JSON.stringify({
          messages: withSystemPrompt(systemPrompt, languageInstruction(language), [
            { role: "user", content: prompt },
          ]),
          temperature: 0.1,
          stream: false,
        }),
      }),
      TIMEOUT_MS
    );
    if (!res.ok) {
      const err = await res.text();
      logger.warn({ err }, "DxGPT API error");
      if (isFallback) return { content: "", error: `DxGPT fallback failed: ${res.status} ${err}`, partial: true };
      return callGeminiChat(prompt, systemPrompt, language, false);
    }
    return { content: extractChatContent(await res.json()) };
  } catch (e: unknown) {
    logger.warn({ msg: errorMessage(e) }, "DxGPT call failed");
    if (isFallback) return { content: "", error: `DxGPT fallback failed: ${errorMessage(e)}`, partial: true };
    return callGeminiChat(prompt, systemPrompt, language, false);
  }
}

// ── Streaming calls ──────────────────────────────────────────────────────────

// Streaming variant for DxGPT chat
export async function* streamDxGPT(
  messages: ChatMessage[],
  systemPrompt: string,
  language = "English"
): AsyncGenerator<string> {
  const apiKey = getEnvSecure("DXGPT_API_KEY");
  const endpoint = getEnvSecure("DXGPT_ENDPOINT");

  if (!apiKey || !endpoint) {
    // Fall back to Gemini streaming
    yield* streamGemini(messages, systemPrompt, language);
    return;
  }

  try {
    const res = await withTimeout(
      fetch(endpoint, {
        method: "POST",
        headers: dxgptHeaders(apiKey),
        body: JSON.stringify({
          messages: withSystemPrompt(systemPrompt, languageInstruction(language, "short"), messages),
          stream: true,
        }),
      }),
      TIMEOUT_MS
    );
    if (!res.ok || !res.body) {
      yield* streamGemini(messages, systemPrompt, language);
      return;
    }
    yield* parseSSETokens(res.body);
  } catch {
    yield* streamGemini(messages, systemPrompt, language);
  }
}

export async function* streamGemini(
  messages: ChatMessage[],
  systemPrompt: string,
  language = "English"
): AsyncGenerator<string> {
  const apiKey = getEnvSecure("GEMINI_API_KEY");
  if (!apiKey) {
    yield "Error: GEMINI_API_KEY not configured. The server administrator needs to set this environment variable.";
    return;
  }
  try {
    const res = await withTimeout(
      fetch(GEMINI_URL, {
        method: "POST",
        headers: geminiHeaders(apiKey),
        body: JSON.stringify({
          model: GEMINI_MODEL,
          messages: withSystemPrompt(systemPrompt, languageInstruction(language), messages),
          stream: true,
          temperature: 0.3,
          max_tokens: 2048,
        }),
      }),
      TIMEOUT_MS
    );
    if (!res.ok || !res.body) {
      yield `Error: AI service returned ${res.status}`;
      return;
    }
    yield* parseSSETokens(res.body);
  } catch (e: unknown) {
    yield `Error: ${errorMessage(e)}`;
  }
}

export async function callAI(
  stage: PipelineStage,
  prompt: string,
  systemPrompt: string,
  options?: { language?: string; jsonMode?: boolean }
): Promise<AIResponse> {
  const language = options?.language ?? "English";
  const jsonMode = options?.jsonMode ?? false;

  // We route all stages to Gemini since it provides free medical-grade reasoning
  // and is not blocked by Azure's Cloudflare WAF like Groq is, and DxGPT endpoints might be down.
  return callGeminiChat(prompt, systemPrompt, language, jsonMode);
}
