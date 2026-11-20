// W5 part B: /verify, the repo's Merkle root against the contract's (design w5-refund-verify §5).
import { fujiDeployment } from '@askpay/shared/abi';
import { BLLD_2019_LAW_ID } from '@askpay/shared/leaf';
import corpusMeta from '@askpay/corpus/meta';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Hex } from 'viem';
import { Providers } from '@/app/providers';
import { VerifyView } from '@/features/verify/components/VerifyView';
import { SELF_CHECK_COMMANDS } from '@/features/verify/components/SelfCheckSteps';
import { verifyMessages as m } from '@/features/verify/messages';
import { formatAnswerWindow, lawVerdict, roleView, ZERO_ROOT } from '@/features/verify/verify-view';
import { PUBLIC_RPC_URL, REPO_URL } from '@/lib/constants';
import { messages } from '@/lib/messages';
import { shortAddress } from '@/lib/format';
import { chainFixture, createTestConfig, resetChain } from '../../helpers/wallet-harness';
import { stubApi } from '../../helpers/ask-api';

const REPO_ROOT = corpusMeta.root as Hex;
const OTHER_ROOT = `0x${'ab'.repeat(32)}` as Hex;
const OTHER_ADDRESS = '0x00000000000000000000000000000000000000aa';

beforeEach(() => {
  resetChain();
  // /verify needs no AskPay server: any call to /api in these tests is a failure.
  stubApi({
    post: [],
    get: () => {
      throw new TypeError('the API is down');
    },
  });
});

function renderVerify() {
  return render(
    <Providers config={createTestConfig()}>
      <VerifyView />
    </Providers>,
  );
}

const lawCard = () => screen.getByRole('region', { name: m.lawTitle });

describe('AP-01-AC04 the law card compares the two roots in the browser', () => {
  it('W5-E14: equal roots: ✓ KHỚP and the matching sentence, both roots in full', async () => {
    chainFixture.lawRoot = REPO_ROOT;
    renderVerify();
    expect(await screen.findByText(m.matchText)).toBeInTheDocument();
    expect(within(lawCard()).getByText(`✓ ${m.match}`)).toBeInTheDocument();
    // The full 66-character roots are on the page, twice (repo and contract), not shortened.
    expect(within(lawCard()).getAllByText(REPO_ROOT)).toHaveLength(2);
    expect(within(lawCard()).getByText(BLLD_2019_LAW_ID)).toBeInTheDocument();
    expect(
      within(lawCard()).getByText((text) => text.includes(corpusMeta.lawName)),
    ).toBeInTheDocument();
  });

  it('W5-E14: different roots: ✗ LỆCH with both roots in full', async () => {
    chainFixture.lawRoot = OTHER_ROOT;
    renderVerify();
    expect(await screen.findByText(m.mismatchText)).toBeInTheDocument();
    expect(within(lawCard()).getByText(`✗ ${m.mismatch}`)).toBeInTheDocument();
    expect(within(lawCard()).getByText(REPO_ROOT)).toBeInTheDocument();
    expect(within(lawCard()).getByText(OTHER_ROOT)).toBeInTheDocument();
    expect(screen.queryByText(m.matchText)).not.toBeInTheDocument();
  });

  it('W5-E14: a zero root is "not registered", not a mismatch', async () => {
    chainFixture.lawRoot = ZERO_ROOT;
    renderVerify();
    expect(await screen.findByText(m.unregisteredText)).toBeInTheDocument();
    expect(within(lawCard()).getByText(m.unregistered)).toBeInTheDocument();
    expect(screen.queryByText(`✗ ${m.mismatch}`)).not.toBeInTheDocument();
  });

  it('W5-E14: a node that fails: "Không đọc được contract." and neither ✓ nor ✗', async () => {
    chainFixture.readsFail = true;
    renderVerify();
    expect(await screen.findByText(m.readFailed, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(`✓ ${m.match}`)).not.toBeInTheDocument();
    expect(screen.queryByText(`✗ ${m.mismatch}`)).not.toBeInTheDocument();
    // The retry asks again, and a good answer then shows the verdict.
    chainFixture.readsFail = false;
    chainFixture.lawRoot = REPO_ROOT;
    await userEvent.setup().click(screen.getByRole('button', { name: m.retry }));
    expect(await screen.findByText(m.matchText)).toBeInTheDocument();
  });

  it('while reading, no verdict is shown', () => {
    chainFixture.lawRoot = REPO_ROOT;
    renderVerify();
    expect(screen.queryByText(m.matchText)).not.toBeInTheDocument();
    expect(screen.queryByText(m.mismatchText)).not.toBeInTheDocument();
  });
});

describe('P5 /verify does not depend on the AskPay server', () => {
  it('W5-E15: with every /api call failing the roots, contract and three steps are all there', async () => {
    chainFixture.lawRoot = REPO_ROOT;
    const api = stubApi({
      post: [],
      get: () => {
        throw new TypeError('the API is down');
      },
    });
    renderVerify();
    expect(await screen.findByText(m.matchText)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: m.contractTitle })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    // The counts come from the repo build, so they show even with the server gone.
    expect(
      within(lawCard()).getByText(
        new RegExp(m.lawCounts(corpusMeta.dieuCount, corpusMeta.khoanCount)),
      ),
    ).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });
});

describe('the contract card', () => {
  it('shows the escrow, provider, checker, window and token, each linked to Snowtrace', async () => {
    renderVerify();
    const card = screen.getByRole('region', { name: m.contractTitle });
    await within(card).findByText(formatAnswerWindow(600));
    expect(within(card).getByText(formatAnswerWindow(600))).toHaveTextContent('10 phút');
    for (const address of [
      fujiDeployment.address,
      fujiDeployment.provider,
      fujiDeployment.checker,
      fujiDeployment.token,
    ]) {
      const link = within(card).getByRole('link', {
        name: new RegExp(shortAddress(address).replace('…', '…')),
      });
      expect(link).toHaveAttribute('href', `https://testnet.snowtrace.io/address/${address}`);
      expect(link).toHaveAttribute('title', address);
    }
    expect(within(card).getByText(`(${m.sourceOnSnowtrace})`)).toBeInTheDocument();
    expect(within(card).getByText(m.rolesNote)).toBeInTheDocument();
  });

  it('W5-E16: a provider on-chain that differs from the deployments file: shows the chain value and says so', async () => {
    chainFixture.provider = OTHER_ADDRESS;
    renderVerify();
    expect(await screen.findByText(m.roleDiffers)).toBeInTheDocument();
    const card = screen.getByRole('region', { name: m.contractTitle });
    expect(within(card).getByTitle(getAddress(OTHER_ADDRESS))).toBeInTheDocument();
    expect(within(card).queryByTitle(fujiDeployment.provider)).not.toBeInTheDocument();
    // Only one role differs.
    expect(within(card).getAllByText(m.roleDiffers)).toHaveLength(1);
  });

  it('roles that cannot be read fall back to the deployments file, and say so', async () => {
    chainFixture.rolesFail = true;
    renderVerify();
    // Provider, checker and the answer window each say where their value comes from.
    await waitFor(() => expect(screen.getAllByText(m.deploymentsFallback)).toHaveLength(3), {
      timeout: 4000,
    });
    const card = screen.getByRole('region', { name: m.contractTitle });
    expect(within(card).getByTitle(fujiDeployment.provider)).toBeInTheDocument();
    expect(within(card).getByText(formatAnswerWindow(600))).toBeInTheDocument();
  });
});

describe('the self-check steps', () => {
  it('W5-E17: the commands hold the real escrow, lawId, repo URL and public RPC', () => {
    renderVerify();
    expect(SELF_CHECK_COMMANDS[0]).toBe(`git clone ${REPO_URL}.git && cd AskPay && npm ci`);
    expect(SELF_CHECK_COMMANDS[1]).toBe(
      'npm run corpus && git diff --exit-code packages/corpus/data',
    );
    expect(SELF_CHECK_COMMANDS[2]).toBe(
      `cast call ${fujiDeployment.address} "lawRoot(bytes32)(bytes32)" ${BLLD_2019_LAW_ID} --rpc-url ${PUBLIC_RPC_URL}`,
    );
    for (const [index, title] of m.steps.entries()) {
      const block = screen.getByLabelText(title);
      expect(block.tagName).toBe('PRE');
      expect(block).toHaveAttribute('tabindex', '0');
      expect(block).toHaveClass('overflow-x-auto');
      expect(block).toHaveTextContent(SELF_CHECK_COMMANDS[index] as string);
    }
  });

  it('W5-E17: Sao chép writes the command to the clipboard and says "Đã sao chép" for 2 s', async () => {
    const user = userEvent.setup();
    renderVerify();
    // userEvent.setup() replaced navigator.clipboard with its own stub: spy on that.
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await user.click(screen.getByRole('button', { name: messages.copyOf(m.steps[2]) }));
      expect(write).toHaveBeenCalledWith(SELF_CHECK_COMMANDS[2]);
      const button = screen.getByRole('button', { name: messages.copyOf(m.steps[2]) });
      expect(button).toHaveTextContent(messages.copied);
      // Said once, politely.
      expect(
        screen
          .getAllByText(messages.copied)
          .some((node) => node.getAttribute('aria-live') === 'polite'),
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(2100);
      await waitFor(() => expect(button).toHaveTextContent(new RegExp(`^${messages.copy}$`)));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what this page does NOT check (Q-13), and that provider and checker are both AskPay', () => {
    renderVerify();
    expect(screen.getByText(m.scopeNote)).toBeInTheDocument();
    expect(screen.getByText(m.rolesNote)).toBeInTheDocument();
    // No interface for citationsHash: the note is text only.
    expect(screen.getByText(m.scopeNote).querySelector('button, a')).toBeNull();
  });
});

describe('page structure', () => {
  it('one h1, an h2 per card, and the page title', () => {
    renderVerify();
    expect(screen.getByRole('heading', { level: 1, name: m.title })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      m.lawTitle,
      m.contractTitle,
      m.stepsTitle,
    ]);
    expect(m.pageTitle).toBe('Tự xác minh · AskPay');
  });
});

describe('W5-E18 the words the spec forbids (§8) are not on /verify', () => {
  it('no forbidden sentence in the messages, and the roles note says both are run by AskPay', () => {
    const all = JSON.stringify(m);
    for (const forbidden of ['Đã xác minh', 'kiểm đúng nguyên văn', 'checker độc lập']) {
      expect(all.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(m.scopeNote).toContain('Merkle root');
    expect(m.rolesNote).toContain('cả hai do AskPay vận hành');
  });

  it('the rendered page has none of them either', async () => {
    chainFixture.lawRoot = REPO_ROOT;
    const { container } = renderVerify();
    await screen.findByText(m.matchText);
    const text = container.textContent?.toLowerCase() ?? '';
    for (const forbidden of ['đã xác minh', 'kiểm đúng nguyên văn', 'checker độc lập']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('corpus meta (U-22): the repo root is the one in the repo, not a number in the page', () => {
  it('equals packages/corpus/data/blld-2019.root.txt, which the corpus script writes', () => {
    // Vitest runs from the repo root.
    const file = resolve(process.cwd(), 'packages/corpus/data/blld-2019.root.txt');
    expect(corpusMeta.root).toBe(readFileSync(file, 'utf8').trim());
    expect(corpusMeta.lawId).toBe(BLLD_2019_LAW_ID);
  });
});

describe('pure rules', () => {
  it('lawVerdict: match, mismatch, unregistered, and the states with no verdict', () => {
    const repo = REPO_ROOT;
    expect(
      lawVerdict(repo, { kind: 'data', root: repo.toUpperCase().replace('0X', '0x') as Hex }),
    ).toEqual({
      kind: 'match',
    });
    expect(lawVerdict(repo, { kind: 'data', root: OTHER_ROOT })).toEqual({ kind: 'mismatch' });
    expect(lawVerdict(repo, { kind: 'data', root: ZERO_ROOT })).toEqual({ kind: 'unregistered' });
    expect(lawVerdict(repo, { kind: 'loading' })).toEqual({ kind: 'loading' });
    expect(lawVerdict(repo, { kind: 'failed' })).toEqual({ kind: 'failed' });
  });

  it('formatAnswerWindow: whole minutes in minutes, anything else in seconds', () => {
    expect(formatAnswerWindow(600)).toBe('10 phút');
    expect(formatAnswerWindow(90)).toBe('90 giây');
    expect(formatAnswerWindow(0)).toBe('0 giây');
  });

  it('roleView: the chain wins and says when the repo file disagrees', () => {
    const inRepo = fujiDeployment.provider;
    expect(roleView(undefined, inRepo)).toEqual({
      address: inRepo,
      source: 'deployments',
      differs: false,
    });
    expect(roleView(inRepo.toLowerCase() as `0x${string}`, inRepo).differs).toBe(false);
    expect(roleView(OTHER_ADDRESS, inRepo)).toEqual({
      address: OTHER_ADDRESS,
      source: 'chain',
      differs: true,
    });
  });
});
