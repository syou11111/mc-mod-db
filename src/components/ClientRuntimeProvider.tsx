'use client';

import React, { useEffect } from 'react';
import { installClientApiInterceptor } from '@/lib/client-api';
import { ensureDbInitialized } from '@/lib/db';
import { installGistAutoSync } from '@/lib/gist-sync';

if (typeof window !== 'undefined') {
  installClientApiInterceptor();
  installGistAutoSync();
}

export function ClientRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    installClientApiInterceptor();
    installGistAutoSync();
    void ensureDbInitialized();
  }, []);

  return <>{children}</>;
}
