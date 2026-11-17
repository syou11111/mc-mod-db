'use client';

import React, { useEffect } from 'react';
import { installClientApiInterceptor } from '@/lib/client-api';
import { ensureDbInitialized } from '@/lib/db';

if (typeof window !== 'undefined') {
  installClientApiInterceptor();
}

export function ClientRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    installClientApiInterceptor();
    void ensureDbInitialized();
  }, []);

  return <>{children}</>;
}
