import { parseEvent } from './parser';
import type { LiveEvent, ParseContext, ParseResult } from './parser';
import type { RawMessage } from './protocol';

export type ClientState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'stopped'
  | 'failed'
  | 'disposed';

export interface ClientStatus {
  status: ClientState;
  roomId?: string;
  resolvedRoomId?: string;
  retryCount: number;
  connectedAt: number | null;
  lastMessageAt: number | null;
}

export interface ClientEventMap {
  event: LiveEvent;
  raw: RawMessage;
  statusChange: ClientStatus;
  error: Error;
  unknownCommand: Extract<ParseResult, { status: 'unknown' }>;
  schemaMismatch: Extract<ParseResult, { status: 'mismatch' }>;
}

export interface ClientLifecycleOptions extends ParseContext {
  reconnect?: false | { maxRetries?: number; initialDelay?: number; maxDelay?: number };
}

interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

export interface Session {
  signal: AbortSignal;
  onRoom: (roomId: string | undefined) => void;
  onReady: () => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onMessages: (messages: RawMessage[]) => void;
  onError: (error: Error) => void;
}

type SessionFactory = (session: Session) => Promise<void>;

interface Run {
  controller: AbortController;
  ready: PromiseWithResolvers<void>;
  task: Promise<void>;
}

export class LiveClient {
  private readonly listeners = new Map<keyof ClientEventMap, Set<unknown>>();
  private readonly state: ClientStatus;
  private readonly retry: false | RetryOptions;
  private run: Run | null = null;

  constructor(
    options: ClientLifecycleOptions,
    private readonly openSession: SessionFactory,
  ) {
    this.state = {
      roomId: options.roomId,
      status: 'idle',
      retryCount: 0,
      connectedAt: null,
      lastMessageAt: null,
    };
    this.retry = resolveRetry(options.reconnect);
  }

  on<K extends keyof ClientEventMap>(
    event: K,
    listener: (value: ClientEventMap[K]) => void | Promise<void>,
  ): () => void {
    const subscription = (value: ClientEventMap[K]) => listener(value);
    const channel = this.listeners.get(event) ?? new Set();
    channel.add(subscription);
    this.listeners.set(event, channel);

    return () => {
      channel.delete(subscription);
    };
  }

  getStatus(): ClientStatus {
    return { ...this.state };
  }

  start(): Promise<void> {
    if (this.state.status === 'disposed') {
      return Promise.reject(new Error('Client is disposed'));
    }

    if (this.run) {
      return this.run.ready.promise;
    }

    const ready = Promise.withResolvers<void>();
    void ready.promise.catch(() => undefined);
    const run: Run = { ready, controller: new AbortController(), task: Promise.resolve() };
    this.run = run;
    this.state.retryCount = 0;
    run.task = Promise.resolve().then(() => this.loop(run));

    return ready.promise;
  }

  async stop(): Promise<void> {
    const run = this.run;
    this.run = null;
    run?.ready.reject(new Error('Client stopped before the session was ready'));
    run?.controller.abort();

    if (this.state.status !== 'disposed') {
      this.changeStatus('stopped');
    }

    await run?.task;
  }

  async restart(): Promise<void> {
    await this.stop();

    return this.start();
  }

  async dispose(): Promise<void> {
    this.changeStatus('disposed');
    await this.stop();
    this.listeners.clear();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  private changeStatus(status: ClientState): void {
    if (this.state.status === status) {
      return;
    }

    this.state.status = status;
    this.emit('statusChange', this.getStatus());
  }

  private emit<K extends keyof ClientEventMap>(event: K, value: ClientEventMap[K]): void {
    const onFailure = () => {
      if (event !== 'error') {
        this.emit('error', new Error('Event subscriber failed'));
      }
    };

    const subscribers = [...(this.listeners.get(event) ?? [])];

    for (const callback of subscribers) {
      try {
        const result = (callback as (value: ClientEventMap[K]) => void | Promise<void>)(value);

        if (result) {
          void result.catch(onFailure);
        }
      } catch {
        onFailure();
      }
    }
  }

  private async loop(run: Run): Promise<void> {
    const { signal } = run.controller;

    if (signal.aborted) {
      return;
    }

    this.changeStatus('connecting');

    while (!signal.aborted) {
      try {
        await this.openSession(this.session(run));
        throw new Error('Live session ended');
      } catch (error) {
        if (!(await this.reconnect(run, error))) {
          return;
        }
      }
    }
  }

  private session(run: Run): Session {
    const { signal } = run.controller;

    return {
      signal,
      onRoom: roomId => {
        if (!signal.aborted) {
          this.state.resolvedRoomId = roomId;
        }
      },
      onReady: () => {
        if (!signal.aborted) {
          run.ready.resolve();
        }
      },
      onConnected: () => {
        if (signal.aborted || this.state.status === 'connected') {
          return;
        }

        this.state.connectedAt = Date.now();
        this.changeStatus('connected');
      },
      onDisconnected: () => {
        if (!signal.aborted) {
          this.changeStatus('connecting');
        }
      },
      onMessages: messages => this.handleMessages(messages, signal),
      onError: error => {
        if (!signal.aborted) {
          this.emit('error', error);
        }
      },
    };
  }

  private handleMessages(messages: RawMessage[], signal: AbortSignal): void {
    if (messages.length && !signal.aborted) {
      this.state.retryCount = 0;
    }

    for (const raw of messages) {
      if (signal.aborted) {
        return;
      }

      this.state.lastMessageAt = Date.now();
      this.emit('raw', raw);

      if (signal.aborted) {
        return;
      }

      const result = parseEvent(raw, { roomId: this.state.resolvedRoomId ?? this.state.roomId });

      switch (result.status) {
        case 'parsed': {
          this.emit('event', result.event);
          break;
        }

        case 'unknown': {
          this.emit('unknownCommand', result);
          break;
        }

        case 'mismatch': {
          this.emit('schemaMismatch', result);
          break;
        }
      }
    }
  }

  private async reconnect(run: Run, cause: unknown): Promise<boolean> {
    const { signal } = run.controller;

    if (signal.aborted) {
      return false;
    }

    const error = cause instanceof Error ? cause : new Error('Live session failed');
    this.emit('error', error);

    if (signal.aborted) {
      return false;
    }

    if (!this.retry || this.state.retryCount >= this.retry.maxRetries) {
      this.run = null;
      run.ready.reject(error);
      this.changeStatus('failed');

      return false;
    }

    const delay = Math.min(
      this.retry.maxDelay,
      this.retry.initialDelay * 2 ** Math.min(this.state.retryCount, 30),
    );

    this.state.retryCount++;
    this.changeStatus('reconnecting');

    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };

        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, delay);

        signal.addEventListener('abort', abort, { once: true });

        if (signal.aborted) {
          abort();
        }
      });

      return !signal.aborted;
    } catch {
      return false;
    }
  }
}

function resolveRetry(value: ClientLifecycleOptions['reconnect']): false | RetryOptions {
  if (value === false) {
    return false;
  }

  const { maxRetries = Infinity, initialDelay = 1000, maxDelay = 30_000 } = value ?? {};

  if (maxRetries !== Infinity && (!Number.isSafeInteger(maxRetries) || maxRetries < 0)) {
    throw new TypeError('reconnect.maxRetries must be a non-negative safe integer or Infinity');
  }

  return {
    maxRetries,
    initialDelay: timerDuration(initialDelay, 'reconnect.initialDelay'),
    maxDelay: timerDuration(maxDelay, 'reconnect.maxDelay'),
  };
}

export function timerDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError(`${name} must be a positive timer duration in milliseconds`);
  }

  return value;
}
