import { ResultView } from '@/features/ask/components/ResultView';

// Thin on purpose (frontend convention §1): read the param, render the feature.
export default async function QuestionPage({ params }: { params: Promise<{ qid: string }> }) {
  const { qid } = await params;
  return <ResultView qid={qid.toLowerCase()} />;
}
