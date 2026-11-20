import type { Metadata } from 'next';
import { VerifyView } from '@/features/verify/components/VerifyView';
import { verifyMessages } from '@/features/verify/messages';

export const metadata: Metadata = { title: verifyMessages.pageTitle };

// Thin on purpose (frontend convention §1): render the feature.
export default function VerifyPage() {
  return <VerifyView />;
}
