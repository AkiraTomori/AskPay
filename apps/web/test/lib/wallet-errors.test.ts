import { describe, expect, it } from 'vitest';
import { classifyWalletError } from '@/lib/wallet-errors';

describe('classifyWalletError', () => {
  it('recognises a user rejection by code or by name', () => {
    expect(classifyWalletError({ code: 4001 })).toBe('rejected');
    expect(classifyWalletError({ name: 'UserRejectedRequestError' })).toBe('rejected');
  });
  it('recognises a request already pending in the wallet', () => {
    expect(classifyWalletError({ code: -32002 })).toBe('pending');
  });
  it('looks through wrapped errors', () => {
    expect(classifyWalletError({ name: 'ConnectError', cause: { code: 4001 } })).toBe('rejected');
  });
  it('treats everything else as other', () => {
    expect(classifyWalletError(new Error('boom'))).toBe('other');
    expect(classifyWalletError('nope')).toBe('other');
  });
});
