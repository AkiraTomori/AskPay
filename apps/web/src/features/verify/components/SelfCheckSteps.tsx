import { fujiDeployment } from '@askpay/shared/abi';
import { BLLD_2019_LAW_ID } from '@askpay/shared/leaf';
import { CopyButton } from '@/components/ui/CopyButton';
import { PUBLIC_RPC_URL, REPO_URL } from '@/lib/constants';
import { verifyMessages as m } from '../messages';

// The three commands, with this deployment's real values filled in. The first two need nothing from
// AskPay: clone the repo, rebuild the Merkle root from the law text in it, ask the chain.
export const SELF_CHECK_COMMANDS = [
  `git clone ${REPO_URL}.git && cd AskPay && npm ci`,
  'npm run corpus && git diff --exit-code packages/corpus/data',
  `cast call ${fujiDeployment.address} "lawRoot(bytes32)(bytes32)" ${BLLD_2019_LAW_ID} --rpc-url ${PUBLIC_RPC_URL}`,
] as const;

const NOTES = [undefined, m.step2Note, m.step3Note] as const;

export function SelfCheckSteps() {
  return (
    <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
      <h2 id="steps-heading" className="text-lg font-semibold">
        {m.stepsTitle}
      </h2>
      <ol className="flex flex-col gap-4">
        {SELF_CHECK_COMMANDS.map((command, index) => {
          const title = m.steps[index] as string;
          return (
            <li key={title} className="flex flex-col gap-2">
              <p className="font-medium">
                {index + 1}. {title}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                {/* Scrolls inside the box, so the page never scrolls sideways at 360px. */}
                <pre
                  tabIndex={0}
                  aria-label={title}
                  className="min-w-0 flex-1 overflow-x-auto rounded-md border border-rule bg-paper p-3 text-sm"
                >
                  <code className="font-mono">{command}</code>
                </pre>
                <CopyButton text={command} what={title} />
              </div>
              {NOTES[index] && <p className="text-sm text-ink-muted">{NOTES[index]}</p>}
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-ink-muted">{m.scopeNote}</p>
    </section>
  );
}
