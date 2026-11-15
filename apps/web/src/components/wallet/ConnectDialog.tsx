'use client';

import { LoaderCircle } from 'lucide-react';
import { useConnect, useConnectors } from 'wagmi';
import type { Connector } from 'wagmi';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { CORE_INSTALL_URL, METAMASK_INSTALL_URL } from '@/lib/constants';
import { messages } from '@/lib/messages';
import { classifyWalletError } from '@/lib/wallet-errors';
import { useConnectDialog } from './connect-dialog-context';

type ConnectDialogProps = { open: boolean; onClose: () => void };

export function ConnectDialog({ open, onClose }: ConnectDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={messages.dialogTitle}>
      <ConnectDialogBody onClose={onClose} />
    </Dialog>
  );
}

// EIP-6963 wallets announce themselves as separate connectors. The static `injected` connector
// is always in the list, even with no wallet installed, so it only counts as a wallet when
// `window.ethereum` exists and nothing was discovered (an older wallet without EIP-6963).
function useWalletOptions(): readonly Connector[] {
  const connectors = useConnectors();
  const discovered = connectors.filter((connector) => connector.id !== 'injected');
  if (discovered.length > 0) return discovered;
  const hasLegacyProvider = typeof window !== 'undefined' && 'ethereum' in window;
  return hasLegacyProvider ? connectors.filter((connector) => connector.id === 'injected') : [];
}

function ConnectDialogBody({ onClose }: { onClose: () => void }) {
  const { focusRequest } = useConnectDialog();
  const options = useWalletOptions();
  const { mutate: connect, isPending, variables, error } = useConnect();
  const kind = error ? classifyWalletError(error) : undefined;

  // After a successful connect the dialog closes without switching chain: two wallet popups in a
  // row make people reject the second. NetworkGuard handles a wrong network afterwards.
  const choose = (connector: Connector) =>
    connect(
      { connector },
      {
        onSuccess: () => {
          focusRequest.current = true;
          onClose();
        },
      },
    );

  if (options.length === 0) {
    return (
      <>
        <p>{messages.noWallet}</p>
        <ul className="flex flex-col gap-2">
          <li>
            <a
              className="underline underline-offset-2"
              href={CORE_INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {messages.installCore} ↗
            </a>
          </li>
          <li>
            <a
              className="underline underline-offset-2"
              href={METAMASK_INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {messages.installMetaMask} ↗
            </a>
          </li>
        </ul>
        <Note />
      </>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {options.map((connector) => {
          const selected = isPending && variables?.connector === connector;
          return (
            <li key={connector.uid}>
              <Button
                variant="secondary"
                className="w-full justify-start"
                disabled={isPending}
                onClick={() => choose(connector)}
              >
                {selected ? (
                  <LoaderCircle aria-hidden className="size-5 animate-spin" />
                ) : connector.icon ? (
                  <img src={connector.icon} alt="" className="size-5" />
                ) : null}
                <span>{connector.id === 'injected' ? messages.browserWallet : connector.name}</span>
                {selected && <span className="ml-auto text-ink-muted">{messages.openWallet}</span>}
              </Button>
            </li>
          );
        })}
      </ul>
      <div aria-live="polite">
        {kind === 'rejected' && <p className="text-ink-muted">{messages.connectRejected}</p>}
        {kind === 'pending' && <p className="text-ink-muted">{messages.requestPending}</p>}
        {kind === 'other' && <p className="text-error">{messages.connectFailed}</p>}
      </div>
      {isPending && (
        <Button variant="ghost" onClick={onClose}>
          {messages.cancel}
        </Button>
      )}
      <Note />
    </>
  );
}

function Note() {
  return <p className="text-sm text-ink-muted">{messages.testnetNote}</p>;
}
