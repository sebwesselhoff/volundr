import { EventEmitter } from 'events';
import { HTTP_TIMEOUT, SDK_QUEUE_MAX } from '@vldr/shared';

interface QueuedRequest {
  method: string;
  path: string;
  body?: unknown;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export class HttpClient extends EventEmitter {
  private baseUrl: string;
  private queue: QueuedRequest[] = [];
  private _isConnected = true;

  constructor(baseUrl: string) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  get queueSize(): number {
    return this.queue.length;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(url, init);
      this._isConnected = true;
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      // 204 No Content
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (err) {
      // Only enqueue mutations on connection errors
      if (
        method !== 'GET' &&
        err instanceof Error &&
        (err.name === 'TypeError' || err.name === 'TimeoutError' || err.message.includes('fetch'))
      ) {
        this._isConnected = false;
        return new Promise<T>((resolve, reject) => {
          this.enqueue({ method, path, body, resolve: resolve as (v: unknown) => void, reject });
        });
      }
      throw err;
    }
  }

  private enqueue(item: QueuedRequest): void {
    if (this.queue.length >= SDK_QUEUE_MAX) {
      const oldest = this.queue.shift()!;
      oldest.reject(new Error('Queue overflow: request dropped'));
      this.emit('queue:overflow', oldest);
    }
    this.queue.push(item);
  }

  async flush(): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const url = `${this.baseUrl}${item.path}`;
        const init: RequestInit = {
          method: item.method,
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(HTTP_TIMEOUT),
        };
        if (item.body !== undefined) {
          init.body = JSON.stringify(item.body);
        }
        const res = await fetch(url, init);
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = res.status === 204 ? undefined : await res.json();
        item.resolve(data);
        succeeded++;
      } catch (err) {
        // Re-enqueue at front and stop on first failure
        this.queue.unshift(item);
        item.reject(err);
        failed++;
        break;
      }
    }

    return { succeeded, failed };
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
