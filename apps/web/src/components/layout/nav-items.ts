import { messages } from '@/lib/messages';

// One place to add pages.
export const NAV_ITEMS = [
  { href: '/', label: messages.navAsk },
  { href: '/dashboard', label: messages.navDashboard },
  { href: '/verify', label: messages.navVerify },
] as const;
