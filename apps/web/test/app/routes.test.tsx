import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { messages } from '@/lib/messages';

// next/font downloads from Google at build time; in tests only the CSS variable name matters.
vi.mock('next/font/google', () => {
  const font = (variable: string) => () => ({ variable, className: '' });
  return {
    Be_Vietnam_Pro: font('--font-be-vietnam'),
    Noto_Serif: font('--font-noto-serif'),
    JetBrains_Mono: font('--font-jetbrains-mono'),
  };
});

const { default: RootLayout } = await import('@/app/layout');
const { default: AskPage } = await import('@/app/page');
const { default: DashboardPage, metadata: dashboardMetadata } =
  await import('@/app/dashboard/page');
const { default: VerifyPage, metadata: verifyMetadata } = await import('@/app/verify/page');
const { default: NotFound } = await import('@/app/not-found');
const { default: ErrorPage } = await import('@/app/error');
const { default: GlobalError } = await import('@/app/global-error');

const noop = () => {};

function expectSingleDisclaimer(html: string) {
  expect(html.split(messages.disclaimer)).toHaveLength(2);
}

describe('/dashboard route', () => {
  it('W4: the tab title is "Dashboard · AskPay"', () => {
    expect(dashboardMetadata.title).toBe('Dashboard · AskPay');
  });
});

describe('/verify route', () => {
  it('W5: the tab title is "Tự xác minh · AskPay"', () => {
    expect(verifyMetadata.title).toBe('Tự xác minh · AskPay');
  });
});

describe('root layout (server render)', () => {
  it.each([
    ['/', <AskPage key="p" />],
    ['/dashboard', <DashboardPage key="d" />],
    ['/verify', <VerifyPage key="v" />],
    ['a route that does not exist', <NotFound key="n" />],
    ['an error page', <ErrorPage key="e" error={new Error('boom')} reset={noop} />],
  ])('AP-07-AC04 W1-E01: shows the disclaimer on %s', (_route, page) => {
    expectSingleDisclaimer(renderToString(<RootLayout>{page}</RootLayout>));
  });

  it('sets the page language to Vietnamese and renders main with the skip-link target', () => {
    const html = renderToString(
      <RootLayout>
        <AskPage />
      </RootLayout>,
    );
    expect(html).toContain('<html lang="vi"');
    expect(html).toContain('id="main"');
    expect(html).toContain('href="#main"');
  });

  it('shows a skeleton, not "Kết nối ví", before the wallet state is known', () => {
    const html = renderToString(
      <RootLayout>
        <AskPage />
      </RootLayout>,
    );
    expect(html).not.toContain(`>${messages.connect}<`);
  });

  it('renders the footer from static data: contract address and law name', () => {
    const html = renderToString(
      <RootLayout>
        <AskPage />
      </RootLayout>,
    );
    expect(html).toContain('0x869e…dce0');
    expect(html).toContain(messages.lawName);
  });
});

describe('global-error', () => {
  it('AP-07-AC04 W1-E01: renders its own disclaimer because it replaces the root layout', () => {
    const html = renderToString(<GlobalError error={new Error('boom')} reset={noop} />);
    expectSingleDisclaimer(html);
    expect(html).toContain('<html lang="vi"');
  });
});
