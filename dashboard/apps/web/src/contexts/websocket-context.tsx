'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useWebSocket } from '@/hooks/use-websocket';

type WsContextType = ReturnType<typeof useWebSocket>;
const WsContext = createContext<WsContextType | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket();
  return <WsContext.Provider value={ws}>{children}</WsContext.Provider>;
}

export function useWs() {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWs must be used within WebSocketProvider');
  return ctx;
}
