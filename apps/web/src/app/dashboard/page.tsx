import type { Metadata } from 'next';
import { DashboardView } from '@/features/dashboard/components/DashboardView';
import { dashboardMessages } from '@/features/dashboard/messages';

export const metadata: Metadata = { title: dashboardMessages.pageTitle };

// Thin on purpose (frontend convention §1): render the feature.
export default function DashboardPage() {
  return <DashboardView />;
}
