import { WebSocket } from 'ws';
import type { RawData } from 'ws';

import { resolveConnection } from './api';
import type { CookieSource, Fetcher } from './api';
import { LiveClient, timerDuration } from './client';
import type { ClientLifecycleOptions, Session } from './client';
import { decodeFrame } from './protocol';
import { createWebcastSigner } from './signature';

type UrlSource = string | ((signal: AbortSignal) => string | Promise<string>);

interface WebSocketSettings {
  headers: Record<string, string>;
}

interface TransportOptions extends Omit<ClientLifecycleOptions, 'roomId'> {
  cookie?: CookieSource;
  fetch?: Fetcher;
  createWebSocket?: (url: string, options: WebSocketSettings) => WebSocket;
  connectTimeout?: number;
  heartbeatInterval?: number;
}

export type ClientOptions = TransportOptions &
  ({ roomId: string | number; url?: UrlSource } | { roomId?: never; url: UrlSource });

export function createClient(options: ClientOptions): LiveClient {
  const roomId = normalizeRoomId(options.roomId);
  const { url } = options;
  const connectTimeout = timerDuration(options.connectTimeout ?? 15_000, 'connectTimeout');
  const heartbeatInterval = timerDuration(options.heartbeatInterval ?? 5000, 'heartbeatInterval');
  const sign = createWebcastSigner();
  const fetcher = options.fetch ?? fetch;

  if (roomId === undefined && url === undefined) {
    throw new TypeError('Provide a Douyin live room ID or WebSocket URL');
  }

  return new LiveClient({ ...options, roomId }, async session => {
    const preparation = AbortSignal.any([session.signal, AbortSignal.timeout(connectTimeout)]);
    const cookie = await readCookie(options.cookie, preparation);

    const connection =
      url === undefined && roomId !== undefined
        ? await abortable(
            resolveConnection({
              webRoomId: roomId,
              cookie,
              fetch: fetcher,
              signal: preparation,
              sign,
            }),
            preparation,
          )
        : await resolveUrl(url, cookie, preparation);

    preparation.throwIfAborted();
    session.onRoom(connection.roomId);
    let socket: WebSocket;

    try {
      socket = options.createWebSocket
        ? options.createWebSocket(connection.url, { headers: connection.headers })
        : new WebSocket(connection.url, {
            headers: connection.headers,
            handshakeTimeout: connectTimeout,
            maxPayload: 16 * 1024 * 1024,
          });
    } catch {
      throw new Error('Could not create the Douyin WebSocket');
    }

    await openSocket(socket, session, connectTimeout, heartbeatInterval);
  });
}

function normalizeRoomId(value: string | number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError('roomId must use a string for integers outside the safe range');
  }

  const text = String(value);

  if (!/^[1-9]\d{0,19}$/.test(text)) {
    throw new TypeError('roomId must be a positive decimal ID');
  }

  return text;
}

async function readCookie(source: CookieSource | undefined, signal: AbortSignal): Promise<string> {
  try {
    signal.throwIfAborted();
    const value = typeof source === 'function' ? source(signal) : source;
    const cookie = (await abortable(Promise.resolve(value), signal)) ?? '';

    if (typeof cookie !== 'string' || /[\r\n\0]/.test(cookie)) {
      throw new Error('Invalid Cookie');
    }

    return cookie;
  } catch {
    throw new Error('Douyin Cookie provider failed or was cancelled');
  }
}

async function resolveUrl(
  source: UrlSource | undefined,
  cookie: string,
  signal: AbortSignal,
): Promise<{
  url: string;
  headers: Record<string, string>;
  roomId?: string;
}> {
  try {
    signal.throwIfAborted();
    const input = typeof source === 'function' ? source(signal) : source;
    const value = await abortable(Promise.resolve(input), signal);
    const url = value && URL.parse(value);

    if (!url || (url.protocol !== 'ws:' && url.protocol !== 'wss:')) {
      throw new Error('Invalid WebSocket URL');
    }

    const headers: Record<string, string> = {};

    if (cookie && url.protocol === 'wss:' && url.hostname.endsWith('.douyin.com')) {
      headers.cookie = cookie;
    }

    return { url: url.href, headers };
  } catch {
    // 地址提供方抛出的错误可能带有签名或登录凭据。
    throw new Error('Could not resolve the Douyin WebSocket URL');
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const abort = Promise.withResolvers<never>();
  const cancel = () => abort.reject(signal.reason);
  const result = Promise.race([promise, abort.promise]);

  signal.addEventListener('abort', cancel, { once: true });

  if (signal.aborted) {
    cancel();
  }

  try {
    return await result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

async function openSocket(
  socket: WebSocket,
  session: Session,
  timeout: number,
  heartbeatInterval: number,
): Promise<void> {
  const done = Promise.withResolvers<void>();

  const deadline = setTimeout(
    () => done.reject(new Error('WebSocket connection timed out')),
    timeout,
  );

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let awaitingPong = false;

  function onOpen(): void {
    clearTimeout(deadline);
    session.onConnected();
    session.onReady();

    if (session.signal.aborted) {
      return;
    }

    heartbeat = setInterval(() => {
      if (awaitingPong) {
        done.reject(new Error('Douyin heartbeat timed out'));

        return;
      }

      awaitingPong = true;
      socket.ping(Buffer.from([0x3a, 0x02, 0x68, 0x62]), true, error => {
        if (error) {
          done.reject(new Error('Could not send the Douyin heartbeat'));
        }
      });
    }, heartbeatInterval);
  }

  function onMessage(data: RawData, isBinary: boolean): void {
    if (!isBinary || session.signal.aborted) {
      return;
    }

    try {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data);
      const { messages, ack } = decodeFrame(bytes);

      if (ack) {
        socket.send(encodeAck(ack.logId, ack.payload));
      }

      session.onMessages(messages);
    } catch {
      session.onError(new Error('Could not process the Douyin WebSocket message'));
    }
  }

  const onPong = () => {
    awaitingPong = false;
  };

  const onClose = (code: number) => done.reject(new Error(`WebSocket closed (code ${code})`));
  const onError = () => done.reject(new Error('Douyin WebSocket transport failed'));
  const stop = () => done.resolve();
  socket.on('open', onOpen);
  socket.on('message', onMessage);
  socket.on('pong', onPong);
  socket.on('close', onClose);
  socket.on('error', onError);
  session.signal.addEventListener('abort', stop, { once: true });

  if (session.signal.aborted) {
    stop();
  }

  try {
    await done.promise;
  } finally {
    clearTimeout(deadline);
    clearInterval(heartbeat);
    session.signal.removeEventListener('abort', stop);
    socket.off('open', onOpen);
    socket.off('message', onMessage);
    socket.off('pong', onPong);
    socket.off('close', onClose);
    socket.off('error', onError);
    socket.on('error', () => undefined);
    socket.terminate();
  }
}

function encodeAck(logId: bigint, payload: Uint8Array): Buffer {
  const header = Buffer.from([
    0x10,
    ...varint(logId),
    0x3a,
    0x03,
    0x61,
    0x63,
    0x6b,
    0x42,
    ...varint(BigInt(payload.length)),
  ]);

  return Buffer.concat([header, payload]);
}

function varint(input: bigint): number[] {
  let value = input;
  const bytes: number[] = [];

  while (value > 0x7fn) {
    bytes.push(Number(value & 0x7fn) | 0x80);
    value >>= 7n;
  }

  bytes.push(Number(value));

  return bytes;
}
