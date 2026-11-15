'use client';

import { createContext } from 'react';

// True once wagmi's automatic reconnect on page load has finished (or given up waiting).
// Outside <Providers> it defaults to true, so the hook stays usable in isolation.
export const ReconnectSettledContext = createContext(true);
