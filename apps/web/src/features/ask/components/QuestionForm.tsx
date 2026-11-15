import { MAX_QUESTION_LENGTH } from '@askpay/shared/api';
import { useId, type KeyboardEvent, type Ref } from 'react';
import { askMessages } from '../messages';
import type { QuestionCheck } from '../question';

type Props = {
  value: string;
  check: QuestionCheck;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void; // Ctrl/⌘+Enter
  textareaRef: Ref<HTMLTextAreaElement>;
};

// The textarea stays editable without a wallet; it is read-only only once a signature is in play.
export function QuestionForm({ value, check, readOnly, onChange, onSubmit, textareaRef }: Props) {
  const id = useId();
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;
  const tooLong = !check.ok && check.reason === 'tooLong';

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {askMessages.questionLabel}
      </label>
      <textarea
        id={id}
        ref={textareaRef}
        rows={4}
        value={value}
        readOnly={readOnly}
        placeholder={askMessages.placeholder}
        aria-describedby={tooLong ? `${counterId} ${errorId}` : counterId}
        aria-invalid={tooLong || undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-y rounded-md border border-ink-muted bg-surface px-3 py-2 text-ink placeholder:text-ink-muted read-only:bg-paper"
      />
      <div className="mt-1 flex items-start justify-between gap-4 text-sm">
        {/* Polite, and only filled when there is something to say: the counter itself stays silent. */}
        <p id={errorId} aria-live="polite" className="text-error">
          {tooLong ? askMessages.tooLong : ''}
        </p>
        <p id={counterId} className={tooLong ? 'text-error' : 'text-ink-muted'}>
          {check.length}/{MAX_QUESTION_LENGTH}
        </p>
      </div>
    </div>
  );
}
