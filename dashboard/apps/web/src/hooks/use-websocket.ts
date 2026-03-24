'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { API_PORT } from '@vldr/shared';
import type { ServerMessage, DashboardCommand } from '@vldr/shared';

const WS_URL = `ws://localhost:${API_PORT}/ws`;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const listenersRef = useRef<Set<(msg: ServerMessage) => void>>(new Set());

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', role: 'browser' }));
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          // All parsed messages are forwarded to subscribers as-is.
          // Unknown message types are safely ignored by each subscriber's own switch.
          for (const listener of listenersRef.current) listener(msg);
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setTimeout(connect, 3000);
      };
    }

    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  const subscribe = useCallback((handler: (msg: ServerMessage) => void) => {
    listenersRef.current.add(handler);
    return () => { listenersRef.current.delete(handler); };
  }, []);

  const sendCommand = useCallback((cmd: DashboardCommand) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  return { isConnected, subscribe, sendCommand };
}
