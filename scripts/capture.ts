import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createClient } from '../src';
import { JsonlWriter } from './jsonl';
import { integer, roomIds, runLiveClients } from './live';

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { anonymous: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });

  if (values.help) {
    console.log('bun scripts/capture.ts [--anonymous] [网页直播间号 ...]');
    console.log('未传房间号时使用 DOUYIN_ROOM_IDS。配置见 docs/collection.md。');

    return;
  }

  const ids = roomIds(positionals.length ? positionals : [process.env.DOUYIN_ROOM_IDS ?? '']);
  const cookie = values.anonymous ? undefined : process.env.DOUYIN_COOKIE?.trim();

  const seconds = integer(
    process.env.DOUYIN_CAPTURE_SECONDS,
    0,
    'DOUYIN_CAPTURE_SECONDS',
    0,
    2_147_483,
  );

  const maxBytes = integer(
    process.env.DOUYIN_CAPTURE_MAX_BYTES,
    64 * 1024 * 1024,
    'DOUYIN_CAPTURE_MAX_BYTES',
    1,
  );

  const base = resolve(process.env.DOUYIN_CAPTURE_OUTPUT ?? '.captures');
  const authentication = cookie ? 'authenticated' : 'anonymous';
  const controller = new AbortController();
  using writer = new JsonlWriter(base, maxBytes);

  const clients = ids.map(webRoomId => {
    const client = createClient({ roomId: webRoomId, cookie });
    client.on('error', error => console.warn(`房间 ${webRoomId} · ${error.message}`));
    client.on('raw', raw => {
      if (controller.signal.aborted) {
        return;
      }

      try {
        writer.write({
          version: 1,
          receivedAt: new Date().toISOString(),
          roomId: client.getStatus().resolvedRoomId ?? webRoomId,
          webRoomId,
          authentication,
          raw: {
            method: raw.method,
            id: raw.id,
            payload: Buffer.from(raw.payload).toString('base64'),
          },
        });
      } catch (error) {
        controller.abort(error);
      }
    });

    return client;
  });

  console.log(`采集 ${ids.join(', ')} → ${writer.directory}`);
  await runLiveClients(clients, seconds, controller);
  console.log(JSON.stringify(writer.getStatus()));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : '采集失败');
  process.exitCode = 1;
}
