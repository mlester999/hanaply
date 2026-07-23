import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Plus and Pro plans for Hanaply.',
};

export default function PricingPage(): never {
  redirect('/#pricing');
}
