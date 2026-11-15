// The cache behind /health, /stats and the first page of /questions (A6 review, findings 1-2).
import { describe, expect, it, vi } from 'vitest';
import { createTtlCache } from '../../src/shared/ttl-cache.js';

const clock = () => {
  const time = { now: 0 };
  return { time, now: () => time.now };
};

describe('createTtlCache', () => {
  it('loads once and serves the same value until the TTL has passed', async () => {
    const { time, now } = clock();
    const cache = createTtlCache<number>(5_000, now);
    const load = vi.fn(async () => ++time.now);
    const first = await cache.get('k', load);
    time.now += 4_999;
    expect(await cache.get('k', load)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    time.now += 2;
    expect(await cache.get('k', load)).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('requests that arrive during a load share it instead of starting their own', async () => {
    const { now } = clock();
    const cache = createTtlCache<string>(5_000, now);
    let release: (value: string) => void = () => undefined;
    const load = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const all = Promise.all([cache.get('k', load), cache.get('k', load), cache.get('k', load)]);
    release('once');
    expect(await all).toEqual(['once', 'once', 'once']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never keeps a failed load: the next call tries again, and everyone waiting sees the failure', async () => {
    const { now } = clock();
    const cache = createTtlCache<string>(5_000, now);
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('rpc'))
      .mockResolvedValueOnce('fine');
    await expect(cache.get('k', load)).rejects.toThrow('rpc');
    expect(await cache.get('k', load)).toBe('fine');
  });

  it('does not keep a value the caller refuses (an answer that only describes a failure)', async () => {
    const { now } = clock();
    const cache = createTtlCache<'down' | 'ok'>(5_000, now);
    const load = vi
      .fn<() => Promise<'down' | 'ok'>>()
      .mockResolvedValueOnce('down')
      .mockResolvedValueOnce('ok');
    const keep = (value: string) => value === 'ok';
    expect(await cache.get('k', load, keep)).toBe('down');
    expect(await cache.get('k', load, keep)).toBe('ok'); // no waiting for the TTL
    expect(await cache.get('k', load, keep)).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keys are independent, and the number of kept keys is bounded', async () => {
    const { now } = clock();
    const cache = createTtlCache<string>(5_000, now, 2);
    const load = vi.fn(async () => 'v');
    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('c', load); // evicts the oldest, 'a'
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get('b', load);
    await cache.get('c', load);
    expect(load).toHaveBeenCalledTimes(3); // still kept
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(4); // was evicted
  });
});
