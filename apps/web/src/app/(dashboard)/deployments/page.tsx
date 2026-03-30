import { DeploymentsPage } from '@/components/deployments/deployments-page';
import { notFound } from 'next/navigation';

export default function DeploymentsRoute() {
  if (process.env.NEXT_PUBLIC_KORTIX_DEPLOYMENTS_ENABLED !== 'true') {
    notFound();
  }

  return <DeploymentsPage />;
}
