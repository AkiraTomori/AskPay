import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ButtonView } from '../ask-view';

export const ASK_BUTTON_ID = 'ask-button';

export function AskButton({
  view,
  onClick,
  buttonRef,
}: {
  view: ButtonView;
  onClick: () => void;
  buttonRef: React.Ref<HTMLButtonElement>;
}) {
  if (view.kind === 'skeleton') return <Skeleton className="h-10 w-full sm:w-56" />;
  return (
    <Button
      id={ASK_BUTTON_ID}
      ref={buttonRef}
      loading={view.loading}
      disabled={view.disabled}
      onClick={onClick}
      className="w-full sm:w-auto"
    >
      {view.label}
    </Button>
  );
}
