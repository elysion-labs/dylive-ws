import { ProtoMessage } from './protobuf';
import type { RawMessage } from './protocol';

export interface LiveUser {
  name: string;
  id?: string;
  /** 财富等级，来自 User.pay_grade.level。 */
  payLevel?: number;
  /** 用户佩戴的粉丝团灯牌，仅在等级大于 0 时出现。 */
  fansClub?: { name: string; level: number };
}

interface EventBase {
  user: LiveUser;
  id?: string;
  roomId?: string;
  platformTime?: string;
}

export interface ChatEvent extends EventBase {
  type: 'message';
  content: string;
}

export interface GiftEvent extends EventBase {
  type: 'gift';
  gift: {
    id: string;
    name?: string;
    diamondCount?: number;
    /** 礼物目录标记为可连击。 */
    combo: boolean;
    /** 粉丝团专属礼物。 */
    fansClub: boolean;
  };
  /** 同一连击组的推送共用此 ID。 */
  groupId?: string;
  groupCount: number;
  repeatCount: number;
  comboCount: number;
  totalCount?: number;
  /** 连击组的结束推送。 */
  repeatEnd: boolean;
  /** 团播等场景里指定的接收人。 */
  recipient?: LiveUser;
}

export interface MemberEvent extends EventBase {
  type: 'member';
  /** 平台下发的当前在线人数。 */
  memberCount?: number;
}

export interface LikeEvent extends EventBase {
  type: 'like';
  count: number;
  total?: number;
}

export interface FollowEvent extends EventBase {
  type: 'follow';
  followCount?: number;
}

export interface FansClubEvent extends EventBase {
  type: 'fansclub';
  action: 'join' | 'upgrade';
  content?: string;
}

export type LiveEvent =
  | ChatEvent
  | GiftEvent
  | MemberEvent
  | LikeEvent
  | FollowEvent
  | FansClubEvent;

export interface ParseContext {
  roomId?: string;
}

export type ParseResult =
  | { status: 'parsed'; event: LiveEvent; raw: RawMessage }
  | { status: 'unknown'; raw: RawMessage }
  | { status: 'mismatch'; raw: RawMessage; issue: string };

type Parser = (raw: RawMessage, context: ParseContext) => LiveEvent | undefined;

const parsers: Record<string, Parser> = {
  WebcastChatMessage: parseChat,
  WebcastGiftMessage: parseGift,
  WebcastMemberMessage: parseMember,
  WebcastLikeMessage: parseLike,
  WebcastSocialMessage: parseSocial,
  WebcastFansclubMessage: parseFansClub,
};

export function parseEvent(raw: RawMessage, context: ParseContext = {}): ParseResult {
  const parser = Object.hasOwn(parsers, raw.method) ? parsers[raw.method] : undefined;

  if (!parser) {
    return { status: 'unknown', raw };
  }

  try {
    const event = parser(raw, context);

    return event ? { status: 'parsed', raw, event } : { status: 'unknown', raw };
  } catch (error) {
    return {
      status: 'mismatch',
      raw,
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseChat(raw: RawMessage, context: ParseContext): ChatEvent {
  const chat = new ProtoMessage(raw.payload, [1, 2, 3]);
  const content = chat.string(3);

  if (content === undefined) {
    throw new Error('Missing chat text in protobuf field 3');
  }

  return { type: 'message', content, ...base(raw, context, chat, 2) };
}

function parseGift(raw: RawMessage, context: ParseContext): GiftEvent {
  const message = new ProtoMessage(raw.payload, [1, 2, 4, 5, 6, 7, 8, 9, 11, 15, 29]);
  const giftId = nonzero(message.uint64(2));

  if (giftId === undefined) {
    throw new Error('Missing gift ID in protobuf field 2');
  }

  return {
    type: 'gift',
    gift: readCatalog(giftId, message.dataField(15)),
    groupId: nonzero(message.uint64(11)),
    groupCount: count(message.uint64(4)) ?? 1,
    repeatCount: count(message.uint64(5)) ?? 1,
    comboCount: count(message.uint64(6)) ?? 1,
    totalCount: count(message.uint64(29)),
    repeatEnd: message.uint64(9) === '1',
    recipient: readRecipient(message.dataField(8)),
    ...base(raw, context, message, 7),
  };
}

function readCatalog(id: string, bytes: Uint8Array | undefined): GiftEvent['gift'] {
  const catalog = new ProtoMessage(bytes ?? new Uint8Array(), [9, 10, 12, 16]);

  return {
    id,
    name: nonempty(catalog.string(16)),
    diamondCount: count(catalog.uint64(12)),
    combo: catalog.uint64(10) === '1',
    fansClub: catalog.uint64(9) === '1',
  };
}

function readRecipient(bytes: Uint8Array | undefined): LiveUser | undefined {
  const recipient = bytes && readUser(bytes);

  return recipient?.name || recipient?.id ? recipient : undefined;
}

function parseMember(raw: RawMessage, context: ParseContext): MemberEvent {
  const message = new ProtoMessage(raw.payload, [1, 2, 3]);

  return {
    type: 'member',
    memberCount: count(message.uint64(3)),
    ...base(raw, context, message, 2),
  };
}

function parseLike(raw: RawMessage, context: ParseContext): LikeEvent {
  const message = new ProtoMessage(raw.payload, [1, 2, 3, 5]);

  return {
    type: 'like',
    count: count(message.uint64(2)) ?? 1,
    total: count(message.uint64(3)),
    ...base(raw, context, message, 5),
  };
}

function parseSocial(raw: RawMessage, context: ParseContext): FollowEvent | undefined {
  const message = new ProtoMessage(raw.payload, [1, 2, 4, 6]);

  // action 1 为关注主播，分享等其他动作交给 unknown 并保留原始载荷。
  if (message.uint64(4) !== '1') {
    return undefined;
  }

  return {
    type: 'follow',
    followCount: count(message.uint64(6)),
    ...base(raw, context, message, 2),
  };
}

function parseFansClub(raw: RawMessage, context: ParseContext): FansClubEvent | undefined {
  const message = new ProtoMessage(raw.payload, [1, 2, 3, 4]);

  const action = { 1: 'upgrade', 2: 'join' }[message.uint64(2) ?? ''] as
    | FansClubEvent['action']
    | undefined;

  if (!action) {
    return undefined;
  }

  return {
    type: 'fansclub',
    action,
    content: nonempty(message.string(3)),
    ...base(raw, context, message, 4),
  };
}

function base(
  raw: RawMessage,
  context: ParseContext,
  message: ProtoMessage,
  userField: number,
): EventBase {
  const commonBytes = message.dataField(1);
  const common = commonBytes && new ProtoMessage(commonBytes, [2, 3, 4]);

  return {
    user: readUser(message.dataField(userField) ?? new Uint8Array()),
    id: nonzero(raw.id) ?? nonzero(common?.uint64(2)),
    roomId: nonzero(common?.uint64(3)) ?? context.roomId,
    platformTime: nonzero(common?.uint64(4)),
  };
}

function readUser(bytes: Uint8Array): LiveUser {
  const user = new ProtoMessage(bytes, [1, 3, 23, 24, 1028]);

  const result: LiveUser = {
    name: user.string(3) ?? '',
    id: nonzero(user.string(1028)) ?? nonzero(user.uint64(1)),
  };

  const payGradeBytes = user.dataField(23);
  const payLevel = payGradeBytes && count(new ProtoMessage(payGradeBytes, [6]).uint64(6));

  if (payLevel) {
    result.payLevel = payLevel;
  }

  const fansClubBytes = user.dataField(24);
  const clubBytes = fansClubBytes && new ProtoMessage(fansClubBytes, [1]).dataField(1);
  const club = clubBytes && new ProtoMessage(clubBytes, [1, 2]);
  const clubLevel = count(club?.uint64(2));

  if (club && clubLevel) {
    result.fansClub = { name: club.string(1) ?? '', level: clubLevel };
  }

  return result;
}

function count(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function nonempty(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}

function nonzero(value: string | undefined): string | undefined {
  return value && value !== '0' ? value : undefined;
}
