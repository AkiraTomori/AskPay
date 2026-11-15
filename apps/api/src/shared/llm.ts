// One small client for OpenAI-compatible chat endpoints (OpenRouter, Groq), shared by the answer
// step and the checker's LLM judge. No SDK: the call is one POST, and the failure kinds below are
// what the callers need to decide on a retry (system-design §5.3).
export type LlmProvider = 'openrouter' | 'groq';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  // Asks the provider for a JSON object. Turn it off for a model that rejects `response_format`.
  jsonMode: boolean;
}

const BASE_URLS: Record<LlmProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
};

// Reasoning models spend part of this before writing the JSON, so it is generous.
const MAX_TOKENS = 2000;

export type LlmErrorKind = 'timeout' | 'network' | 'rate-limited' | 'http' | 'empty';

// The message never carries the response body or the key: both can echo the prompt or a secret.
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | undefined;

  constructor(kind: LlmErrorKind, status?: number) {
    super(`LLM call failed: ${kind}${status === undefined ? '' : ` (HTTP ${status})`}`);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
  }
}

export interface LlmRequest {
  system: string;
  user: string;
  timeoutMs: number;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

// Remembers whether the last call worked, for /health. Asking the model "are you there" on every
// ping would spend the daily quota (Groq: ~1,000 requests) on whoever polls; real traffic already
// tells. With no call yet nothing has failed, so it reads ok.
export function trackLlmHealth(client: LlmClient): {
  client: LlmClient;
  status: () => 'ok' | 'down';
} {
  let status: 'ok' | 'down' = 'ok';
  return {
    client: {
      async complete(request) {
        try {
          const reply = await client.complete(request);
          status = 'ok';
          return reply;
        } catch (error) {
          status = 'down';
          throw error;
        }
      },
    },
    status: () => status,
  };
}

export function createLlmClient(config: LlmConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  const url = `${BASE_URLS[config.provider]}/chat/completions`;

  return {
    async complete(request) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            max_tokens: MAX_TOKENS,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            ...(config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: AbortSignal.timeout(request.timeoutMs),
        });
      } catch (error) {
        throw new LlmError(isTimeout(error) ? 'timeout' : 'network');
      }

      if (response.status === 429) throw new LlmError('rate-limited', 429);
      if (!response.ok) throw new LlmError('http', response.status);

      // The headers can arrive long before the body (a slow model behind OpenRouter), so the
      // deadline can fire while the body is being read: that is a timeout, not an empty reply.
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (isTimeout(error)) throw new LlmError('timeout');
        body = undefined;
      }
      const content = readContent(body);
      if (!content) throw new LlmError('empty');
      return content;
    },
  };
}

function isTimeout(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

// choices[0].message.content, or undefined for anything else (null content, tool calls, bad shape).
function readContent(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('choices' in body)) return undefined;
  const choices = body.choices;
  if (!Array.isArray(choices)) return undefined;
  const message: unknown = choices[0]?.message;
  if (typeof message !== 'object' || message === null || !('content' in message)) return undefined;
  const content = message.content;
  return typeof content === 'string' && content.trim().length > 0 ? content : undefined;
}
