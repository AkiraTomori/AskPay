import { fujiDeployment } from '@askpay/shared/abi';
import { Address } from '@/components/ui/Address';
import { snowtraceAddressUrl } from '@/lib/format';
import { dashboardMessages as m } from '../messages';

// AP-08-AC02: says where the numbers come from, and up to which block.
export function ProvenanceNote({
  block,
  reconnecting,
}: {
  block: string | undefined;
  reconnecting: boolean;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
      <span>{block === undefined ? m.noEventsYet : m.provenance(block)}</span>
      <span aria-hidden>·</span>
      <span>{m.contract}</span>
      <Address
        address={fujiDeployment.address}
        href={snowtraceAddressUrl(fujiDeployment.address)}
        className="text-ink"
      />
      {reconnecting && (
        <>
          <span aria-hidden>·</span>
          <span>{m.reconnecting}</span>
        </>
      )}
    </p>
  );
}
