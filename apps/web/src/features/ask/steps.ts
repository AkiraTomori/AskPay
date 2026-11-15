import type { QuestionResult } from '@askpay/shared/api';

// Four steps of AP-07-AC03, mapped from the server's `stage` (design W2 §8).
export type StepState = 'pending' | 'running' | 'done' | 'skipped';
export type Stage = QuestionResult['stage'];

const RANK: Record<Stage, number> = {
  QUOTED: 0,
  EXPIRED: 0,
  DEPOSITING: 1,
  ANSWERING: 2,
  CHECKING: 3,
  SETTLING: 4,
  PAID: 5,
  REFUNDED: 5,
};

export type StepsInput = {
  // undefined: the signature has just been sent and the server has not answered yet.
  stage: Stage | undefined;
  status?: QuestionResult['status'];
  reason?: QuestionResult['reason'];
  settleTx?: string | undefined;
};

// A refund can skip the later steps; those show "bỏ qua", never a tick (design §8).
function skippedSteps(reason: StepsInput['reason']): number {
  if (reason === 'ANSWER_FAILED') return 2; // steps 2 and 3 did not run
  if (reason === 'NO_CITATION') return 1; // step 3 did not run
  return 0;
}

export function stepStates({ stage, status, reason, settleTx }: StepsInput): StepState[] {
  const rank = stage === undefined ? 1 : RANK[stage];
  if (rank === 0) return ['pending', 'pending', 'pending', 'pending'];
  const finished = status !== undefined && status !== 'PENDING' && settleTx !== undefined;
  const states: StepState[] = [1, 2, 3, 4].map((step) => {
    if (step < rank) return 'done';
    if (step === rank) return 'running';
    return 'pending';
  });
  if (rank >= 5) states[3] = finished ? 'done' : 'running';
  if (status === 'REFUNDED') {
    const skipped = skippedSteps(reason);
    for (let i = 0; i < skipped; i += 1) {
      const index = reason === 'ANSWER_FAILED' ? 1 + i : 2;
      states[index] = 'skipped';
    }
  }
  return states;
}

// The step a screen reader hears when it changes: the first running one, else the last.
export function currentStep(states: StepState[]): number {
  const running = states.indexOf('running');
  return running === -1 ? states.length - 1 : running;
}
