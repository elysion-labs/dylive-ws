import { describe, expect, it } from 'bun:test';

import { parseEvent } from './parser';
import { bytesField, numberField } from './testing/frames';

const common = bytesField(1, Buffer.concat([numberField(2, 11n), numberField(3, 22n)]));

const club = bytesField(1, Buffer.concat([bytesField(1, '团名'), numberField(2, 12n)]));

const user = Buffer.concat([
  numberField(1, 9_007_199_254_740_995n),
  bytesField(3, '观众'),
  bytesField(23, numberField(6, 31n)),
  bytesField(24, club),
]);

const viewer = {
  name: '观众',
  id: '9007199254740995',
  payLevel: 31,
  fansClub: { name: '团名', level: 12 },
};

function parse(method: string, ...fields: Buffer[]) {
  return parseEvent({ method, payload: Buffer.concat([common, ...fields]) });
}

describe('live events', () => {
  it('parses a gift with sender, recipient and catalog', () => {
    const catalog = Buffer.concat([
      numberField(5, 463n),
      numberField(10, 1n),
      numberField(12, 1n),
      bytesField(16, '小心心'),
    ]);

    const result = parse(
      'WebcastGiftMessage',
      numberField(2, 463n),
      numberField(4, 2n),
      numberField(6, 5n),
      bytesField(7, user),
      bytesField(8, bytesField(3, '主播')),
      numberField(9, 1n),
      numberField(11, 77n),
      bytesField(15, catalog),
    );

    expect(result).toMatchObject({
      status: 'parsed',
      event: {
        type: 'gift',
        user: viewer,
        gift: { id: '463', name: '小心心', diamondCount: 1, combo: true, fansClub: false },
        groupId: '77',
        groupCount: 2,
        repeatCount: 1,
        comboCount: 5,
        repeatEnd: true,
        recipient: { name: '主播' },
        id: '11',
        roomId: '22',
      },
    });
  });

  it('reports a gift without an ID as a mismatch', () => {
    expect(parse('WebcastGiftMessage', bytesField(7, user))).toMatchObject({ status: 'mismatch' });
  });

  it('parses room entry', () => {
    expect(parse('WebcastMemberMessage', bytesField(2, user), numberField(3, 1234n))).toMatchObject(
      { status: 'parsed', event: { type: 'member', user: viewer, memberCount: 1234 } },
    );
  });

  it('parses likes', () => {
    const result = parse(
      'WebcastLikeMessage',
      numberField(2, 15n),
      numberField(3, 9000n),
      bytesField(5, user),
    );

    expect(result).toMatchObject({
      status: 'parsed',
      event: { type: 'like', user: viewer, count: 15, total: 9000 },
    });
  });

  it('parses follows and leaves other social actions unknown', () => {
    expect(
      parse('WebcastSocialMessage', bytesField(2, user), numberField(4, 1n), numberField(6, 88n)),
    ).toMatchObject({ status: 'parsed', event: { type: 'follow', user: viewer, followCount: 88 } });

    expect(parse('WebcastSocialMessage', bytesField(2, user), numberField(4, 3n))).toMatchObject({
      status: 'unknown',
    });
  });

  it('parses fans club join and upgrade', () => {
    expect(
      parse(
        'WebcastFansclubMessage',
        numberField(2, 2n),
        bytesField(3, '加入了粉丝团'),
        bytesField(4, user),
      ),
    ).toMatchObject({
      status: 'parsed',
      event: { type: 'fansclub', action: 'join', content: '加入了粉丝团', user: viewer },
    });

    expect(parse('WebcastFansclubMessage', numberField(2, 1n), bytesField(4, user))).toMatchObject({
      status: 'parsed',
      event: { type: 'fansclub', action: 'upgrade' },
    });

    expect(parse('WebcastFansclubMessage', numberField(2, 9n))).toMatchObject({
      status: 'unknown',
    });
  });

  it('omits empty badges and does not resolve prototype methods', () => {
    const result = parse('WebcastMemberMessage', bytesField(2, bytesField(3, '路人')));

    expect(result.status === 'parsed' && result.event.user).toStrictEqual({
      name: '路人',
      id: undefined,
    });
    expect(parse('toString')).toMatchObject({ status: 'unknown' });
  });
});
