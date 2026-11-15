import { messages } from '@/lib/messages';

// One place to add pages: W5 adds "Xác minh" when that page exists.
export const NAV_ITEMS = [
  { href: '/', label: messages.navAsk },
  { href: '/dashboard', label: messages.navDashboard },
] as const;
