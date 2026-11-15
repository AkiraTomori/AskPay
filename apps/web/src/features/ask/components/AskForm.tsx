'use client';

import { useEffect, useRef, useState } from 'react';
import { useSwitchChain } from 'wagmi';
import { useConnectDialog } from '@/components/wallet/connect-dialog-context';
import { FUJI_CHAIN_ID } from '@/lib/constants';
import { useAsk, useCountdown } from '../hooks';
import { askMessages } from '../messages';
import { AskButton } from './AskButton';
import { AskNotice } from './AskNotice';
import { PriceNotice } from './PriceNotice';
import { QuestionForm } from './QuestionForm';
import { SampleChips } from './SampleChips';
import { StepTimeline } from './StepTimeline';

const EXPIRING_SOON_MS = 30_000;

// Wires the parts together. All reasoning about the payment flow lives in `useAsk`.
export function AskForm() {
  const [draft, setDraft] = useState('');
  const { state, check, locked, button, notice, ask, pay, retrySend, reset } = useAsk(draft);
  const { openConnectDialog } = useConnectDialog();
  const { mutate: switchChain } = useSwitchChain();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const quote = state.kind === 'quoted' || state.kind === 'signing' ? state.quote : undefined;
  const remainingMs = useCountdown(state.kind === 'quoted' ? state.quote.expiresAt : undefined);

  // A fresh quote moves focus to the pay button, so a keyboard user does not have to Tab for it.
  // After a cancelled signature (quoted -> quoted) focus stays where it is.
  const previousKind = useRef(state.kind);
  useEffect(() => {
    if (previousKind.current === 'quoting' && state.kind === 'quoted') buttonRef.current?.focus();
    previousKind.current = state.kind;
  }, [state.kind]);

  const edit = (value: string) => {
    setDraft(value);
    reset();
  };

  const onButton = () => {
    if (button.kind !== 'button' || button.disabled) return;
    switch (button.action) {
      case 'ask':
        return ask();
      case 'pay':
        return void pay();
      case 'retrySend':
        return retrySend();
      case 'connect':
        return openConnectDialog();
      case 'switchChain':
        return switchChain({ chainId: FUJI_CHAIN_ID });
      case 'none':
        return;
    }
  };

  // Ctrl/⌘+Enter presses the primary button, only while it is enabled.
  const onShortcut = () => onButton();

  const stage = state.kind === 'submitting' || state.kind === 'unsure' ? state.stage : undefined;
  const showTimeline = state.kind === 'submitting' || state.kind === 'unsure';
  const expiringSoon =
    remainingMs !== undefined && remainingMs <= EXPIRING_SOON_MS && remainingMs > 0;

  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onButton();
      }}
    >
      <QuestionForm
        value={draft}
        check={check}
        readOnly={locked}
        onChange={edit}
        onSubmit={onShortcut}
        textareaRef={textareaRef}
      />
      <SampleChips
        disabled={locked}
        onPick={(question) => {
          edit(question);
          textareaRef.current?.focus();
        }}
      />
      {quote && <PriceNotice quote={quote} remainingMs={remainingMs} />}
      <AskNotice
        notice={
          notice ?? (expiringSoon ? { tone: 'muted', text: askMessages.quoteExpiringSoon } : null)
        }
      />
      <div className="flex sm:justify-end">
        <AskButton view={button} onClick={onButton} buttonRef={buttonRef} />
      </div>
      {showTimeline && <StepTimeline stage={stage} />}
    </form>
  );
}
