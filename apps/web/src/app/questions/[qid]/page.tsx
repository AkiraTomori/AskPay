import { QuestionProgressView } from '@/features/ask/components/QuestionProgressView';

// Thin on purpose (frontend convention §1): read the param, render the feature.
export default async function QuestionPage({ params }: { params: Promise<{ qid: string }> }) {
  const { qid } = await params;
  return <QuestionProgressView qid={qid.toLowerCase()} />;
}
