import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { HEARTBEAT_INTERVAL, WS_RECONNECT_MAX } from '@vldr/shared';
import type { ServerMessage } from '@vldr/shared';

export interface HeartbeatState {
  status: string;
  activeCard?: string;
  activeAgents: number;
}

export class WsClient extends EventEmitter {
  private url: string;
  private projectId: string;
  private ws: WebSocket | null = null;
  private reconnectDelay = 1_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _isConnected = false;
  private _disconnecting = false;

  public heartbeatState: HeartbeatState = {
    status: 'active',
    activeAgents: 0,
  };

  constructor(url: string, projectId: string) {
    super();
    this.url = url;
    this.projectId = projectId;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  connect(): void {
    this._disconnecting = false;
    this._openSocket();
  }

  disconnect(): void {
    this._disconnecting = true;
    this._clearTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
  }

  private _openSocket(): void {
    if (this._disconnecting) return;

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this._isConnected = true;
      this.reconnectDelay = 1_000;
      this._clearTimers();

      // Register as volundr
      this._send({ type: 'register', role: 'volundr', projectId: this.projectId });

      // Start heartbeat
      this.heartbeatTimer = setInterval(() => {
        this._send({ type: 'vldr:heartbeat', ...this.heartbeatState });
      }, HEARTBEAT_INTERVAL);

      this.emit('connected');
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as ServerMessage;
        this.emit('message', msg);
        if (msg.type === 'command:pending') {
          this.emit('command', msg);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      this._isConnected = false;
      this._clearHeartbeat();
      this.emit('disconnected');
      if (!this._disconnecting) {
        this._scheduleReconnect();
      }
    });

    ws.on('error', () => {
      // close event will follow; errors are handled there
    });
  }

  private _scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this._openSocket();
    }, this.reconnectDelay);

    // Exponential backoff capped at WS_RECONNECT_MAX
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, WS_RECONNECT_MAX);
  }

  private _clearTimers(): void {
    this._clearHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendAck(commandId: string, success: boolean, detail?: string): void {
    this._send({ type: 'vldr:ack', commandId, success, ...(detail !== undefined ? { detail } : {}) });
  }

  updateHeartbeat(status: string, activeCard?: string, activeAgents?: number): void {
    this.heartbeatState.status = status;
    if (activeCard !== undefined) this.heartbeatState.activeCard = activeCard;
    if (activeAgents !== undefined) this.heartbeatState.activeAgents = activeAgents;
  }
}
