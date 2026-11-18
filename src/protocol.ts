import { gunzipSync } from 'node:zlib';

import { ProtoMessage } from './protobuf';

export interface RawMessage {
  method: string;
  payload: Uint8Array;
  id?: string;
}

const maxFrameBytes = 16 * 1024 * 1024;
const controlTypes = new Set(['hb', 'ack', 'pong']);

export function decodeMessages(frame: Uint8Array): RawMessage[] {
  return decodeFrame(frame).messages;
}

export function decodeFrame(frame: Uint8Array): {
  messages: RawMessage[];
  ack?: { logId: bigint; payload: Uint8Array };
} {
  if (frame.length > maxFrameBytes) {
    throw new Error('WebSocket message exceeds the size limit');
  }

  const push = new ProtoMessage(frame, [2, 6, 7, 8]);
  const type = push.string(7) ?? '';
  const payload = push.dataField(8);

  if (!payload?.length || controlTypes.has(type)) {
    return { messages: [] };
  }

  const body = expandPayload(payload, push.string(6));
  const response = new ProtoMessage(body, [1, 5, 9]);

  const messages = response.repeatedBytes(1).map(bytes => {
    const message = new ProtoMessage(bytes, [1, 2, 3]);

    return {
      method: message.string(1) ?? '',
      payload: message.dataField(2) ?? new Uint8Array(),
      id: message.uint64(3),
    };
  });

  if (response.uint64(9) === '1') {
    const logId = BigInt(push.uint64(2) ?? '0');
    const payload = response.dataField(5) ?? new Uint8Array();

    return { messages, ack: { logId, payload } };
  }

  return { messages };
}

export function decodeCdpPayload(payloadData: string): RawMessage[] {
  if (payloadData.length > Math.ceil(maxFrameBytes / 3) * 4) {
    throw new Error('CDP payload exceeds the size limit');
  }

  const bytes = Buffer.from(payloadData, 'base64');

  if (bytes.toString('base64') !== payloadData) {
    throw new Error('Invalid CDP Base64 payload');
  }

  return decodeMessages(bytes);
}

function expandPayload(payload: Uint8Array, encoding = ''): Uint8Array {
  if (encoding === 'gzip' || (payload[0] === 0x1f && payload[1] === 0x8b)) {
    return gunzipSync(payload, { maxOutputLength: maxFrameBytes });
  }

  if (encoding && encoding !== 'identity') {
    throw new Error(`Unsupported payload encoding: ${encoding}`);
  }

  return payload;
}
