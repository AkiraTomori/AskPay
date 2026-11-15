import { askMessages } from '../messages';

export function SampleChips({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (question: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">{askMessages.samplesLabel}</span>
      {askMessages.samples.map((sample) => (
        <button
          key={sample.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(sample.question)}
          className="min-h-8 rounded-full border border-ink-muted bg-surface px-3 text-sm hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sample.label}
        </button>
      ))}
    </div>
  );
}
