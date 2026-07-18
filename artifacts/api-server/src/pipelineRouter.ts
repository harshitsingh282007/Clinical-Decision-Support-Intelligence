// Pipeline Router - routes AI calls to Groq or DxGPT based on stage
// Groq stages: ocr_cleanup, entity_extract, prescription_parse, lab_structure, intake_generate
// DxGPT stages: correlate, diagnose, confidence_score, report_generate, chat_reason

import { logger } from "./lib/logger.js";
import { errorMessage } from "./lib/errors.js";

const GROQ_STAGES = new Set([
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

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

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

function groqHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
}

function dxgptHeaders(apiKey: string): Record<string, string> {
  return { ...groqHeaders(apiKey), "x-api-key": apiKey };
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

// ── Non-streaming calls ──────────────────────────────────────────────────────

async function callGroqChat(
  prompt: string,
  systemPrompt: string,
  language: string,
  jsonMode: boolean
): Promise<AIResponse> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) {
    return { content: "", error: "GROQ_API_KEY not configured", partial: true };
  }
  try {
    const res = await withTimeout(
      fetch(GROQ_URL, {
        method: "POST",
        headers: groqHeaders(apiKey),
        body: JSON.stringify({
          model: GROQ_MODEL,
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
    if (!res.ok) {
      const err = await res.text();
      if (jsonMode) {
        logger.error({ err }, "Groq API error");
        return { content: "", error: `Groq API error: ${res.status}`, partial: true };
      }
      return { content: "", error: `Groq API error: ${res.status} ${err}`, partial: true };
    }
    return { content: extractChatContent(await res.json()) };
  } catch (e: unknown) {
    const msg = errorMessage(e);
    return { content: "", error: msg, timedOut: msg.includes("timed out"), partial: true };
  }
}

async function callDxGPT(prompt: string, systemPrompt: string, language = "English"): Promise<AIResponse> {
  const apiKey = process.env["DXGPT_API_KEY"];
  const endpoint = process.env["DXGPT_ENDPOINT"];

  // Fall back to Groq if DxGPT not configured
  if (!apiKey || !endpoint) {
    logger.warn("DxGPT not configured, falling back to Groq");
    return callGroqChat(prompt, systemPrompt, language, false);
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
      logger.warn({ err }, "DxGPT API error, falling back to Groq");
      return callGroqChat(prompt, systemPrompt, language, false);
    }
    return { content: extractChatContent(await res.json()) };
  } catch (e: unknown) {
    logger.warn({ msg: errorMessage(e) }, "DxGPT call failed, falling back to Groq");
    return callGroqChat(prompt, systemPrompt, language, false);
  }
}

// ── Streaming calls ──────────────────────────────────────────────────────────

// Streaming variant for DxGPT chat
export async function* streamDxGPT(
  messages: ChatMessage[],
  systemPrompt: string,
  language = "English"
): AsyncGenerator<string> {
  const apiKey = process.env["DXGPT_API_KEY"];
  const endpoint = process.env["DXGPT_ENDPOINT"];

  if (!apiKey || !endpoint) {
    // Fall back to Groq streaming
    yield* streamGroq(messages, systemPrompt, language);
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
      yield* streamGroq(messages, systemPrompt, language);
      return;
    }
    yield* parseSSETokens(res.body);
  } catch {
    yield* streamGroq(messages, systemPrompt, language);
  }
}

export async function* streamGroq(
  messages: ChatMessage[],
  systemPrompt: string,
  language = "English"
): AsyncGenerator<string> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) {
    yield "Error: GROQ_API_KEY not configured. The server administrator needs to set this environment variable.";
    return;
  }
  try {
    const res = await withTimeout(
      fetch(GROQ_URL, {
        method: "POST",
        headers: groqHeaders(apiKey),
        body: JSON.stringify({
          model: GROQ_MODEL,
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

  if (GROQ_STAGES.has(stage)) {
    return callGroqChat(prompt, systemPrompt, language, jsonMode);
  }
  if (DXGPT_STAGES.has(stage)) {
    return callDxGPT(prompt, systemPrompt, language);
  }
  return { content: "", error: `Unknown stage: ${stage}`, partial: true };
}
