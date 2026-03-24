import { getClients, getBrowserClients, getVolundrClient } from './server.js';
import type { ServerMessage } from '@vldr/shared';

export function broadcastToAll(message: ServerMessage) {
  const data = JSON.stringify(message);
  for (const client of getClients().values()) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch {
        // Client connection broken — will be cleaned up on close event
      }
    }
  }
}

export function broadcastToBrowsers(message: ServerMessage) {
  const data = JSON.stringify(message);
  for (const client of getBrowserClients()) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(data);
      } catch {
        // Client connection broken — will be cleaned up on close event
      }
    }
  }
}

export function sendToVolundr(message: ServerMessage) {
  const mc = getVolundrClient();
  if (mc && mc.ws.readyState === 1) {
    try {
      mc.ws.send(JSON.stringify(message));
    } catch {
      // Client connection broken — will be cleaned up on close event
    }
  }
}
