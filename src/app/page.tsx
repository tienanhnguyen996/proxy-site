'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/library');
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--meta-fg)', animation: 'pulse 1.5s infinite' }}>
        Loading AetherRead...
      </div>
    </div>
  );
}
