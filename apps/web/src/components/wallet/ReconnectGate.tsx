'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useConnection } from 'wagmi';
import { ReconnectSettledContext } from './reconnect-context';

// After hydration wagmi still needs a tick to rehydrate storage and start reconnecting, and in
// that gap it reports "disconnected". Showing "Kết nối ví" for that one frame, then the account,
// is a flash (design W1 §3.2). So the wallet UI stays in `loading` until the reconnect attempt has
// been seen to start and finish. wagmi always passes through "reconnecting"/"connecting" on mount;
// the timer is only a safety net so a missed transition can never leave the skeleton up forever.
const SAFETY_MS = 2000;

export function ReconnectGate({ children }: { children: ReactNode }) {
  const { status } = useConnection();
  const [settled, setSettled] = useState(false);
  const sawAttempt = useRef(false);

  useEffect(() => {
    if (settled) return;
    if (status === 'reconnecting' || status === 'connecting') sawAttempt.current = true;
    else if (status === 'connected' || sawAttempt.current) setSettled(true);
  }, [status, settled]);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), SAFETY_MS);
    return () => clearTimeout(timer);
  }, []);

  return <ReconnectSettledContext value={settled}>{children}</ReconnectSettledContext>;
}
