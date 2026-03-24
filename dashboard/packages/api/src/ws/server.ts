import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingWsMessage } from '@vldr/shared';
import { VLDR_OFFLINE_THRESHOLD } from '@vldr/shared';

export interface WsClient {
  ws: WebSocket;
  role: 'browser' | 'volundr';
  projectId?: string;
  lastHeartbeat?: number;
}

const clients = new Map<WebSocket, WsClient>();
const pendingCommands = new Map<string, { timer: NodeJS.Timeout }>();

export function getClients() { return clients; }
export function getPendingCommands() { return pendingCommands; }

export function getBrowserClients(): WsClient[] {
  return [...clients.values()].filter(c => c.role === 'browser');
}

export function getVolundrClient(): WsClient | undefined {
  return [...clients.values()].find(c => c.role === 'volundr');
}

export function isVolundrOnline(): boolean {
  const mc = getVolundrClient();
  if (!mc || !mc.lastHeartbeat) return false;
  return Date.now() - mc.lastHeartbeat < VLDR_OFFLINE_THRESHOLD;
}

export function setupWebSocket(server: Server, onMessage: (client: WsClient, msg: IncomingWsMessage) => void) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const client: WsClient = { ws, role: 'browser' };
    clients.set(ws, client);

    ws.on('message', (raw) => {
      try {
        const msg: IncomingWsMessage = JSON.parse(raw.toString());
        onMessage(client, msg);
      } catch (e) {
        console.error('Invalid WS message:', e);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  return wss;
}
