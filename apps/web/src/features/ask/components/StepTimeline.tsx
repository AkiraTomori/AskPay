import { Check, Circle, LoaderCircle, Minus } from 'lucide-react';
import { askMessages } from '../messages';
import { currentStep, stepStates, type StepState, type StepsInput } from '../steps';

const ICONS: Record<StepState, typeof Check> = {
  done: Check,
  running: LoaderCircle,
  skipped: Minus,
  pending: Circle,
};

// Neutral verbs only. "Đã thanh toán" / "Đã hoàn tiền" are about `status` (the chain), which is
// StatusBadge's job in W3; this list says what the server is doing, nothing more (P2).
export function StepTimeline(props: StepsInput) {
  const states = stepStates(props);
  const notHeld = props.stage === 'QUOTED' || props.stage === 'EXPIRED';
  const label = (index: number) =>
    index === 0 && notHeld ? askMessages.notHeld : askMessages.steps[index];
  const current = currentStep(states);
  return (
    <div>
      <ol aria-label={askMessages.stepsLabel} className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        {states.map((state, index) => {
          const Icon = ICONS[state];
          return (
            <li key={askMessages.steps[index]} className="flex items-center gap-2 text-sm">
              <Icon
                aria-hidden
                className={`size-4 ${state === 'running' ? 'animate-spin text-pending' : state === 'done' ? 'text-paid' : 'text-ink-muted'}`}
              />
              <span className={state === 'pending' ? 'text-ink-muted' : ''}>
                {label(index)} <span className="sr-only">({askMessages.stepState[state]})</span>
              </span>
            </li>
          );
        })}
      </ol>
      {/* Announces the step when it changes, not on every poll: the text only changes with the step. */}
      <p aria-live="polite" className="sr-only">
        {label(current)}: {askMessages.stepState[states[current] ?? 'pending']}
      </p>
    </div>
  );
}
