/* eslint-disable no-console -- 示例程序直接显示直播间消息。 */
import { parseArgs } from 'node:util';

import { createClient } from '@elysionjs/dylive-ws';
import type { LiveEvent } from '@elysionjs/dylive-ws';

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
  client.on('event', event => console.log(describe(event)));
  client.on('error', error => console.error(error.message));

  await runLiveClients([client], seconds);
}

function describe(event: LiveEvent): string {
  switch (event.type) {
    case 'message': {
      return `${event.user.name}: ${event.content}`;
    }

    case 'gift': {
      return `${event.user.name} 送出 ${event.gift.name ?? event.gift.id} x${event.comboCount}`;
    }

    case 'member': {
      return `${event.user.name} 进入直播间`;
    }

    case 'like': {
      return `${event.user.name} 点赞 x${event.count}`;
    }

    case 'follow': {
      return `${event.user.name} 关注了主播`;
    }

    case 'fansclub': {
      return (
        event.content ?? `${event.user.name} ${event.action === 'join' ? '加入' : '升级'}粉丝团`
      );
    }
  }
}
