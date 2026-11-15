export type WalletErrorKind = 'rejected' | 'pending' | 'other';

// Wallets report errors in several shapes: viem errors carry `name` and `code`, raw EIP-1193
// providers only a numeric `code`. 4001 = user rejected, -32002 = a request is already pending.
export function classifyWalletError(error: unknown): WalletErrorKind {
  if (typeof error !== 'object' || error === null) return 'other';
  const { name, code } = error as { name?: unknown; code?: unknown };
  if (code === 4001 || name === 'UserRejectedRequestError') return 'rejected';
  if (code === -32002 || name === 'ResourceUnavailableRpcError') return 'pending';
  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? 'other' : classifyWalletError(cause);
}
