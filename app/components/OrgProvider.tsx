'use client';

import { createContext, useContext } from 'react';

const OrgContext = createContext<string | null>(null);

export function OrgProvider({
  orgId,
  children,
}: {
  orgId: string | null;
  children: React.ReactNode;
}) {
  return <OrgContext.Provider value={orgId}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}
