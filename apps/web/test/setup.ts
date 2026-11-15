import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  routerPush.mockClear();
  vi.unstubAllGlobals();
});

// jsdom has no <dialog>.showModal(); emulate the part the code relies on (open state + close event).
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  if (!this.hasAttribute('open')) return;
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

// One shared spy so tests can assert navigation (read it with `useRouter().push`).
const routerPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
