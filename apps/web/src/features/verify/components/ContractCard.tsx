'use client';

import { fujiDeployment } from '@askpay/shared/abi';
import { Address } from '@/components/ui/Address';
import { CopyButton } from '@/components/ui/CopyButton';
import { snowtraceAddressUrl } from '@/lib/format';
import { useOnChainRoles } from '../hooks';
import { verifyMessages as m } from '../messages';
import { formatAnswerWindow, roleView, type RoleView } from '../verify-view';

// The contract and who runs it. Provider, checker and the window are read from the chain; if that
// fails the page shows the deployments file and says so (the chain wins when it can be read).
export function ContractCard() {
  const roles = useOnChainRoles();
  const provider = roleView(roles.provider, fujiDeployment.provider);
  const checker = roleView(roles.checker, fujiDeployment.checker);
  const windowSeconds = roles.answerWindow ?? fujiDeployment.answerWindow;
  const windowFromFile = roles.answerWindow === undefined && !roles.loading;

  return (
    <section
      aria-labelledby="contract-heading"
      className="flex flex-col gap-3 rounded-md border border-rule bg-surface p-4 shadow-card"
    >
      <h2 id="contract-heading" className="text-lg font-semibold">
        {m.contractTitle}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-[auto_1fr] sm:gap-x-6">
        <Item label={m.escrow}>
          <AddressWithCopy address={fujiDeployment.address} what={m.escrow} />
          <span className="text-sm text-ink-muted">({m.sourceOnSnowtrace})</span>
        </Item>
        <Item label={m.provider}>
          <RoleLine role={provider} what={m.provider} />
        </Item>
        <Item label={m.checker}>
          <RoleLine role={checker} what={m.checker} />
        </Item>
        <Item label={m.answerWindow}>
          <span>{formatAnswerWindow(windowSeconds)}</span>
          {windowFromFile && (
            <span className="text-sm text-ink-muted">{m.deploymentsFallback}</span>
          )}
        </Item>
        <Item label={m.token}>
          <span>USDC</span>
          <AddressWithCopy address={fujiDeployment.token} what={m.token} />
        </Item>
      </dl>
      <p className="text-sm text-ink-muted">{m.rolesNote}</p>
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">{children}</dd>
    </>
  );
}

function AddressWithCopy({ address, what }: { address: string; what: string }) {
  return (
    <>
      <Address address={address} href={snowtraceAddressUrl(address)} />
      <CopyButton text={address} what={what} />
    </>
  );
}

function RoleLine({ role, what }: { role: RoleView; what: string }) {
  return (
    <>
      <AddressWithCopy address={role.address} what={what} />
      {role.source === 'deployments' && (
        <span className="text-sm text-ink-muted">{m.deploymentsFallback}</span>
      )}
      {role.differs && <span className="w-full text-sm text-ink-muted">{m.roleDiffers}</span>}
    </>
  );
}
