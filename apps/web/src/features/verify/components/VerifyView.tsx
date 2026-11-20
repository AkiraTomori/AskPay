import { verifyMessages as m } from '../messages';
import { ContractCard } from './ContractCard';
import { LawCard } from './LawCard';
import { SelfCheckSteps } from './SelfCheckSteps';

// /verify (design W5 part B). Public and read-only: it needs no wallet and no AskPay server, only
// this repo's build and the chain.
export function VerifyView() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{m.title}</h1>
        <p className="text-ink-muted">{m.intro}</p>
      </header>
      <LawCard />
      <ContractCard />
      <SelfCheckSteps />
    </div>
  );
}
