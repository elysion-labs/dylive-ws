import { ProtoMessage } from './protobuf';
import type { RawMessage } from './protocol';

export interface ChatEvent {
  type: 'message';
  content: string;
  user: {
    name: string;
    id?: string;
  };
  id?: string;
  roomId?: string;
  platformTime?: string;
}

export interface ParseContext {
  roomId?: string;
}

export type ParseResult =
  | { status: 'parsed'; event: ChatEvent; raw: RawMessage }
  | { status: 'unknown'; raw: RawMessage }
  | { status: 'mismatch'; raw: RawMessage; issue: string };

export function parseEvent(raw: RawMessage, context: ParseContext = {}): ParseResult {
  if (raw.method !== 'WebcastChatMessage') {
    return { status: 'unknown', raw };
  }

  try {
    return { status: 'parsed', raw, event: parseChat(raw, context) };
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

  const userBytes = chat.dataField(2);
  const user = new ProtoMessage(userBytes ?? new Uint8Array(), [1, 3, 1028]);
  const commonBytes = chat.dataField(1);
  const common = commonBytes && new ProtoMessage(commonBytes, [2, 3, 4]);

  return {
    type: 'message',
    content,
    user: {
      name: user.string(3) ?? '',
      id: nonzero(user.string(1028)) ?? nonzero(user.uint64(1)),
    },
    id: nonzero(raw.id) ?? nonzero(common?.uint64(2)),
    roomId: nonzero(common?.uint64(3)) ?? context.roomId,
    platformTime: nonzero(common?.uint64(4)),
  };
}

function nonzero(value: string | undefined): string | undefined {
  return value && value !== '0' ? value : undefined;
}
