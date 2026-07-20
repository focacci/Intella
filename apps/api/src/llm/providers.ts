import Anthropic from "@anthropic-ai/sdk";

import type { LlmProvider, ProviderCallInput, ProviderResponse } from "./types.js";

// ---------------------------------------------------------------------------
// The two model routes behind the gateway.
//
// Both return the SAME shape — tool-call arguments plus token counts — so the
// gateway can run the identical validator over either. That symmetry is the
// point: a locally-routed call is not "trusted less", it is checked exactly the
// same way, which is what makes routing a pure cost/latency decision rather
// than a correctness one.
// ---------------------------------------------------------------------------

/**
 * Per-million-token USD rates used for the `LlmCall.costEst` running total that
 * the monthly ceiling is enforced against. Locally-run models cost nothing to
 * call, so the local route logs zero and never consumes budget.
 */
const CLAUDE_RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 }
};

/** Unknown model → price it as the most expensive tier, so we never under-bill. */
const FALLBACK_RATE = { input: 5, output: 25 };

export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const rate = CLAUDE_RATES[model] ?? FALLBACK_RATE;
  const cost = (tokensIn / 1_000_000) * rate.input + (tokensOut / 1_000_000) * rate.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Raised when a provider is unreachable or errors — distinct from a validation failure. */
export class ProviderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean }) {
    super(message);
    this.name = "ProviderError";
    this.retryable = options.retryable;
  }
}

// ------------------------------------------------------------------- Anthropic

export function createAnthropicProvider(apiKey: string): LlmProvider {
  const client = new Anthropic({ apiKey });

  return {
    route: "claude",
    async call(input: ProviderCallInput): Promise<ProviderResponse> {
      let response;

      try {
        response = await client.messages.create({
          model: input.model,
          max_tokens: 16000,
          system: input.system,
          messages: input.messages.map((message) => ({
            role: message.role,
            content: message.content
          })),
          tools: [
            {
              name: input.toolName,
              description: input.toolDescription,
              // Strict tool use guarantees the arguments validate against the
              // schema, which removes an entire class of repair round-trips.
              strict: true,
              input_schema: input.toolSchema as Anthropic.Tool["input_schema"]
            }
          ],
          // Force the tool so the model cannot answer in prose — this generator
          // has exactly one acceptable output shape.
          tool_choice: { type: "tool", name: input.toolName }
        });
      } catch (error) {
        throw toProviderError(error);
      }

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === input.toolName
      );

      if (!toolUse) {
        // Forced tool_choice makes this near-impossible, but a refusal stop
        // reason can still land here. Treat it as non-retryable so the caller
        // degrades to rules rather than burning the budget on retries.
        throw new ProviderError(
          `Model returned no ${input.toolName} tool call (stop_reason=${response.stop_reason}).`,
          { retryable: false }
        );
      }

      return {
        output: toolUse.input,
        model: response.model,
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens
      };
    }
  };
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.APIError) {
    // 429 and 5xx are transient; 4xx means our request is wrong and retrying
    // it verbatim will fail identically.
    const retryable = error.status === 429 || error.status >= 500;
    return new ProviderError(`Anthropic ${error.status}: ${error.message}`, {
      retryable
    });
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(`Anthropic unreachable: ${error.message}`, {
      retryable: true
    });
  }

  return new ProviderError(
    error instanceof Error ? error.message : "Unknown Anthropic failure",
    { retryable: true }
  );
}

// ----------------------------------------------------------------------- Local

/**
 * Ollama's OpenAI-compatible chat endpoint. Local models are far less reliable
 * at strict tool calls than Claude, so this route accepts EITHER a tool call or
 * a bare JSON object in the message body, and extracts a JSON object from a
 * fenced code block if the model wrapped it. Whatever comes out still faces the
 * same validator, so leniency here cannot produce a bad artifact — only a
 * repair round or a fallback.
 */
export function createLocalProvider(endpoint: string): LlmProvider {
  return {
    route: "local",
    async call(input: ProviderCallInput): Promise<ProviderResponse> {
      const url = `${endpoint.replace(/\/+$/, "")}/v1/chat/completions`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: input.model,
            messages: [
              { role: "system", content: input.system },
              ...input.messages
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: input.toolName,
                  description: input.toolDescription,
                  parameters: input.toolSchema
                }
              }
            ],
            tool_choice: "auto",
            stream: false
          })
        });
      } catch (error) {
        throw new ProviderError(
          `Local model at ${endpoint} unreachable: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
          { retryable: true }
        );
      }

      if (!response.ok) {
        throw new ProviderError(
          `Local model at ${endpoint} returned ${response.status}.`,
          { retryable: response.status >= 500 }
        );
      }

      const body = (await response.json()) as LocalChatResponse;
      const message = body.choices?.[0]?.message;

      if (!message) {
        throw new ProviderError("Local model returned no choices.", {
          retryable: false
        });
      }

      const toolArgs = message.tool_calls?.[0]?.function?.arguments;
      const output =
        toolArgs !== undefined
          ? parseJsonLoose(toolArgs)
          : parseJsonLoose(message.content ?? "");

      if (output === null) {
        throw new ProviderError("Local model returned no parseable JSON.", {
          retryable: false
        });
      }

      return {
        output,
        model: body.model ?? input.model,
        tokensIn: body.usage?.prompt_tokens ?? 0,
        tokensOut: body.usage?.completion_tokens ?? 0
      };
    }
  };
}

type LocalChatResponse = {
  model?: string;
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function?: { arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Parse JSON that may be wrapped in prose or a ```json fence. Returns null when
 * nothing parseable is present — the caller turns that into a ProviderError.
 */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const direct = tryParse(trimmed);
  if (direct !== undefined) {
    return direct;
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed !== undefined) {
      return parsed;
    }
  }

  // Last resort: the outermost {...} span in the text.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const parsed = tryParse(trimmed.slice(start, end + 1));
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return null;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
