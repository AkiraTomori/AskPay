import { ERROR_CODES, type ErrorCode } from '@askpay/shared/errors';
import { Button } from '@/components/ui/Button';
import { dashboardMessages as m } from '../messages';

// A whole block that could not load. Never shows zeros in place of data. RATE_LIMITED has its own
// sentence; any other failure uses the block's generic one, without an error code (design W4 §7).
export function BlockError({
  message,
  code,
  onRetry,
}: {
  message: string;
  code: ErrorCode | undefined;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p>{code === 'RATE_LIMITED' ? ERROR_CODES.RATE_LIMITED.message : message}</p>
      <Button variant="secondary" onClick={onRetry}>
        {m.retry}
      </Button>
    </div>
  );
}
