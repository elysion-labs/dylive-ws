/* eslint-disable no-console -- 示例程序直接显示直播间消息。 */
import { parseArgs } from 'node:util';

import { createClient } from '@elysionjs/dylive-ws';

import { integer, roomIds, runLiveClients } from '../scripts/live';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { anonymous: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
});

if (values.help) {
  console.log('bun examples/live.ts [--anonymous] <网页直播间号>');
} else {
  const [roomId] = roomIds(positionals.length ? positionals : [process.env.DOUYIN_ROOM_IDS ?? '']);

  const seconds = integer(
    process.env.DOUYIN_EXAMPLE_SECONDS,
    0,
    'DOUYIN_EXAMPLE_SECONDS',
    0,
    2_147_483,
  );

  const cookie = values.anonymous ? undefined : process.env.DOUYIN_COOKIE?.trim();
  const client = createClient({ roomId, cookie, reconnect: { maxRetries: 3 } });

  client.on('statusChange', state =>
    console.log(state.status, state.resolvedRoomId ?? state.roomId),
  );
  client.on('event', event => console.log(event.user.name, event.content));
  client.on('error', error => console.error(error.message));

  await runLiveClients([client], seconds);
}
