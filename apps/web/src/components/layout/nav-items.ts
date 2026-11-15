import { messages } from '@/lib/messages';

// One place to add pages: W4 adds "Dashboard", W5 adds "Xác minh" when those pages exist.
export const NAV_ITEMS = [{ href: '/', label: messages.navAsk }] as const;
