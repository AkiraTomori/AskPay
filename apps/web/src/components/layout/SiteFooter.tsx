import { fujiDeployment } from '@askpay/shared/abi';
import { Address } from '@/components/ui/Address';
import { snowtraceAddressUrl } from '@/lib/format';
import { messages } from '@/lib/messages';

// Static data only (from shared), so the footer renders even when the API is down.
export function SiteFooter() {
  return (
    <footer className="bg-paper pb-6">
      <p className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-2 px-4 text-sm text-ink-muted">
        <span>{messages.contract}</span>
        <Address
          address={fujiDeployment.address}
          href={snowtraceAddressUrl(fujiDeployment.address)}
          className="text-ink"
        />
        <span aria-hidden>·</span>
        <span>{messages.lawName}</span>
      </p>
    </footer>
  );
}
