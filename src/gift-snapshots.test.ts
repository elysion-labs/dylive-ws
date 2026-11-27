import { expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseEvent } from './parser';
import { ProtoMessage } from './protobuf';
import { decodeMessages } from './protocol';
import { pushFrame } from './testing/frames';
import capture from './testing/live/electron/gifts/manifest.json';

it.each(capture.fixtures)('replays captured gift $file', ({ file, sha256, expected }) => {
  const path = new URL(`./testing/live/electron/gifts/${file}`, import.meta.url);
  const payload = readFileSync(path);
  const hash = createHash('sha256').update(payload).digest('hex');

  expect(hash).toBe(sha256);

  const [message] = decodeMessages(pushFrame([{ method: capture.method, payload }], 'gzip'));

  expect(message.method).toBe(capture.method);
  expect(message.payload).toEqual(new Uint8Array(payload));

  const gift = new ProtoMessage(message.payload, [2, 4, 5, 6, 8, 9, 11, 15, 29]);
  const catalogBytes = gift.dataField(15);

  if (catalogBytes === undefined) {
    throw new Error('Captured gift payload must include a catalog entry');
  }

  const catalog = new ProtoMessage(catalogBytes, [5, 9, 10, 11, 12, 16, 42]);
  expect(catalog.uint64(5)).toBe(gift.uint64(2));

  expect({
    giftId: gift.uint64(2),
    name: catalog.string(16),
    diamondCount: catalog.uint64(12),
    giftType: catalog.uint64(11),
    categoryId: catalog.uint64(42),
    catalogCombo: catalog.uint64(10) === '1',
    fansClubGift: catalog.uint64(9) === '1',
    groupId: gift.uint64(11),
    groupCount: gift.uint64(4),
    repeatCount: gift.uint64(5),
    comboCount: gift.uint64(6),
    repeatEnd: gift.uint64(9) ?? null,
    totalCount: gift.uint64(29),
    recipientPresent: gift.dataField(8) !== undefined,
  }).toEqual(expected);
});

it.each(capture.fixtures)('parses captured gift $file as a gift event', ({ file, expected }) => {
  const payload = readFileSync(new URL(`./testing/live/electron/gifts/${file}`, import.meta.url));
  const [raw] = decodeMessages(pushFrame([{ method: capture.method, payload }]));

  expect(parseEvent(raw, { roomId: 'room' })).toMatchObject({
    status: 'parsed',
    event: {
      type: 'gift',
      gift: {
        id: expected.giftId,
        name: expected.name,
        diamondCount: Number(expected.diamondCount),
        combo: expected.catalogCombo,
        fansClub: expected.fansClubGift,
      },
      groupId: expected.groupId,
      groupCount: Number(expected.groupCount),
      repeatCount: Number(expected.repeatCount),
      comboCount: Number(expected.comboCount),
      totalCount: Number(expected.totalCount),
      repeatEnd: expected.repeatEnd === '1',
      roomId: 'room',
    },
  });
});
