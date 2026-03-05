'use client';

import dynamic from 'next/dynamic';

const ClientHeroGlobe = dynamic(
  () => import('./ClientHeroGlobe'),
  { ssr: false }
);

export default function HeroClientWrapper() {
  return <ClientHeroGlobe />;
}
