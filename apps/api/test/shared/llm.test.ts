import { describe, expect, it, vi } from 'vitest';
import { LlmError, createLlmClient, type LlmConfig } from '../../src/shared/llm.js';

const config: LlmConfig = {
  provider: 'openrouter',
  apiKey: 'sk-test-SECRET',
  model: 'vendor/model:free',
  jsonMode: true,
};
const request = { system: 'sys', user: 'usr', timeoutMs: 5000 };

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

async function failure(fetchImpl: typeof fetch, cfg = config) {
  try {
    await createLlmClient(cfg, fetchImpl).complete(request);
  } catch (error) {
    return error as LlmError;
  }
  throw new Error('expected the call to fail');
}

describe('llm client', () => {
  it('posts an OpenAI-style chat request and returns the message content', async () => {
    const fetchImpl = vi.fn(async () => ok('{"noBasis":true}'));
    expect(
      await createLlmClient(config, fetchImpl as unknown as typeof fetch).complete(request),
    ).toBe('{"noBasis":true}');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-SECRET');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'vendor/model:free',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'usr' },
      ],
    });
  });

  it('uses the Groq endpoint for the groq provider and skips JSON mode when told to', async () => {
    const fetchImpl = vi.fn(async () => ok('x'));
    await createLlmClient(
      { ...config, provider: 'groq', jsonMode: false },
      fetchImpl as unknown as typeof fetch,
    ).complete(request);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(JSON.parse(init.body as string)).not.toHaveProperty('response_format');
  });

  it.each([
    ['null content', ok(null)],
    ['blank content', ok('   ')],
    ['no choices', new Response('{}', { status: 200 })],
    ['not JSON at all', new Response('<html>', { status: 200 })],
  ])('empty: %s', async (_name, response) => {
    expect((await failure((async () => response) as unknown as typeof fetch)).kind).toBe('empty');
  });

  it('rate-limited on 429, http on other errors, with the status', async () => {
    const limited = await failure(
      (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch,
    );
    expect(limited).toMatchObject({ kind: 'rate-limited', status: 429 });
    const broken = await failure(
      (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch,
    );
    expect(broken).toMatchObject({ kind: 'http', status: 503 });
  });

  it('timeout when the request is aborted, network for other failures', async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    expect(
      (
        await failure((async () => {
          throw aborted;
        }) as unknown as typeof fetch)
      ).kind,
    ).toBe('timeout');
    expect(
      (
        await failure((async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch)
      ).kind,
    ).toBe('network');
  });

  it('really times out a slow server', async () => {
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const result = await createLlmClient(config, slow)
      .complete({ ...request, timeoutMs: 50 })
      .catch((e: LlmError) => e);
    expect(result).toMatchObject({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('timeout, not empty, when the headers arrive but the body stalls past the deadline', async () => {
    // OpenRouter answers early and then keeps the body open while a slow model works.
    const stalled = ((_url: string, init: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
            },
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;
    const started = Date.now();
    const result = await createLlmClient(config, stalled)
      .complete({ ...request, timeoutMs: 50 })
      .catch((error: LlmError) => error);
    expect(result).toMatchObject({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('never puts the key or the response body in an error message', async () => {
    const error = await failure(
      (async () =>
        new Response('echo sk-test-SECRET and the prompt', {
          status: 500,
        })) as unknown as typeof fetch,
    );
    expect(error.message).not.toContain('SECRET');
    expect(error.message).not.toContain('prompt');
  });
});
