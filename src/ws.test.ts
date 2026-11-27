import { expect, it } from 'bun:test';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';

import { WebSocket, WebSocketServer } from 'ws';

import type { LiveEvent } from './parser';
import { ProtoMessage } from './protobuf';
import { encodeSignature } from './signature';
import { bytesField, numberField } from './testing/frames';
import { createClient } from './ws';

it('matches reference Webcast signing vectors', () => {
  const stub = Buffer.from('704f436b2558b0d7a1c7e758527dd8f1', 'hex');

  expect(encodeSignature(stub, 1, true, 63, 63)).toBe('6pt0VC0aRZDP7n07');
  expect(encodeSignature(stub, 0, false, 0, 6)).toBe('fD+evFuzasjOC8Uu');
});

it('resolves a web room ID, signs the connection, and hands guest cookies to the socket', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind');
  }

  const webRoomId = 708764876300;
  const roomId = '9007199254740993001';
  const viewerId = '9007199254740993002';

  const state = JSON.stringify({
    roomInfo: { room: { id_str: roomId, status: 2 }, roomId, web_rid: String(webRoomId) },
    user_unique_id: viewerId,
  });

  const page = `<script>self.__pace_f.push([1,${JSON.stringify(state)}])</script>`;
  const resolved = Promise.withResolvers<{ url: URL; cookie: string }>();

  const client = createClient({
    roomId: webRoomId,
    reconnect: false,
    cookie: () => 'sessionid=fixture',
    fetch: async (url, request) => {
      expect(String(url)).toBe(`https://live.douyin.com/${webRoomId}`);
      expect(new Headers(request?.headers).get('cookie')).toBe('sessionid=fixture');

      return new Response(page, { headers: { 'set-cookie': 'ttwid=guest; HttpOnly; Secure' } });
    },
    createWebSocket: (url, { headers }) => {
      resolved.resolve({ url: new URL(url), cookie: headers.cookie });

      return new WebSocket(`ws://127.0.0.1:${address.port}`);
    },
  });

  try {
    await client.start();
    const connection = await resolved.promise;
    expect(connection.url.protocol).toBe('wss:');
    expect(connection.url.searchParams.get('room_id')).toBe(roomId);
    expect(connection.url.searchParams.get('user_unique_id')).toBe(viewerId);
    expect(connection.url.searchParams.get('signature')).toMatch(/^[A-Za-z0-9+/]{16}$/);
    expect(connection.cookie).toBe('sessionid=fixture; ttwid=guest');
    expect(client.getStatus()).toMatchObject({ roomId: String(webRoomId), resolvedRoomId: roomId });
  } finally {
    await client.dispose();
    server.close();
  }
});

it('receives a captured chat payload and acknowledges the batch on the default WS client', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const addr = server.address();

  if (typeof addr === 'string' || !addr) {
    throw new Error('Test server did not bind');
  }

  const raw = readFileSync(new URL('./testing/live/ChatMessage.bin', import.meta.url));
  const envelope = Buffer.concat([bytesField(1, 'WebcastChatMessage'), bytesField(2, raw)]);

  const response = Buffer.concat([
    bytesField(1, envelope),
    bytesField(5, 'cursor'),
    numberField(9, 1n),
  ]);

  const frame = Buffer.concat([
    numberField(2, 9_007_199_254_740_993n),
    bytesField(7, 'msg'),
    bytesField(8, response),
  ]);

  const ack = Promise.withResolvers<Buffer>();
  const heartbeat = Promise.withResolvers<Buffer>();
  server.once('connection', socket => {
    socket.on('message', data => ack.resolve(data as Buffer));
    socket.once('ping', heartbeat.resolve);
    socket.send(frame);
  });

  const client = createClient({
    url: () => `ws://127.0.0.1:${addr.port}`,
    reconnect: false,
    heartbeatInterval: 50,
  });

  const chat = Promise.withResolvers<LiveEvent>();
  client.on('event', chat.resolve);

  try {
    await client.start();
    expect(client.getStatus().status).toBe('connected');
    expect(await chat.promise).toMatchObject({ type: 'message', content: '最后应该给他冻住' });

    const receipt = new ProtoMessage(await ack.promise, [2, 7, 8]);
    expect(receipt.uint64(2)).toBe('9007199254740993');
    expect(receipt.string(7)).toBe('ack');
    expect(receipt.string(8)).toBe('cursor');

    const ping = new ProtoMessage(await heartbeat.promise, [7]);
    expect(ping.string(7)).toBe('hb');
  } finally {
    await client.dispose();
    server.close();
  }
});

it('stops while the WS URL provider is still pending', async () => {
  const waiting = Promise.withResolvers<void>();

  const client = createClient({
    url: () => {
      waiting.resolve();

      return new Promise<string>(() => {});
    },
  });

  const ready = client.start().catch((error: unknown) => error);
  await waiting.promise;
  await client.stop();
  expect(await ready).toBeInstanceOf(Error);
  expect(client.getStatus().status).toBe('stopped');
});
