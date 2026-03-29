import { v4 as uuid } from 'uuid';
import type { IncomingWsMessage, DashboardCommand } from '@vldr/shared';
import { getDb, schema } from '@vldr/db';
import type { WsClient } from './server.js';
import { getPendingCommands } from './server.js';
import { broadcastToBrowsers } from './broadcast.js';

export function handleIncomingMessage(client: WsClient, msg: IncomingWsMessage) {
  switch (msg.type) {
    case 'register':
      client.role = msg.role;
      if (msg.role === 'volundr') {
        client.projectId = (msg as any).projectId;
        client.lastHeartbeat = Date.now();
      }
      break;

    case 'vldr:heartbeat':
      client.lastHeartbeat = Date.now();
      break;

    case 'vldr:ack': {
      const pending = getPendingCommands().get(msg.commandId);
      if (pending) {
        clearTimeout(pending.timer);
        getPendingCommands().delete(msg.commandId);
        if (msg.success) {
          broadcastToBrowsers({ type: 'command:acknowledged', data: { commandId: msg.commandId } });
        } else {
          broadcastToBrowsers({ type: 'command:failed', data: { commandId: msg.commandId, reason: msg.detail || 'Rejected by Volundr' } });
        }
      }
      break;
    }

    default:
      if (msg.type.startsWith('command:')) {
        handleDashboardCommand(msg as DashboardCommand);
      }
  }
}

function handleDashboardCommand(cmd: DashboardCommand) {
  const commandId = uuid();
  const projectId = (cmd as any).projectId;
  const cardId = 'cardId' in cmd ? (cmd as any).cardId : null;

  // Store command in DB — Volundr polls via REST
  try {
    getDb().insert(schema.commands)
      .values({
        id: commandId,
        projectId: projectId || '',
        type: cmd.type,
        cardId,
        payload: JSON.stringify(cmd),
        status: 'pending',
      })
      .run();
  } catch {
    // DB write failed — still broadcast to browsers
  }

  broadcastToBrowsers({
    type: 'command:pending',
    data: { commandId, commandType: cmd.type, target: cardId || projectId },
  });
}
