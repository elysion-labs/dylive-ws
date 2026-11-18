import { createHash, randomInt } from 'node:crypto';

// 兼容网页端 Webcast 握手格式。参考 douyinLive/v2.3.2 的 MIT 实现。
const signatureFields = [
  'live_id',
  'aid',
  'version_code',
  'webcast_sdk_version',
  'room_id',
  'sub_room_id',
  'sub_channel_id',
  'did_rule',
  'user_unique_id',
  'device_platform',
  'device_type',
  'ac',
  'identity',
];

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const webcastAlphabet = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe';
const emptyDigest = digest(digest(''));

function digest(value: string | Uint8Array): Buffer {
  return createHash('md5').update(value).digest();
}

export function createWebcastSigner(): (query: URLSearchParams) => string {
  let counter = 0;

  return query => {
    const fields = signatureFields.map(name => `${name}=${query.get(name) ?? ''}`);
    const stub = digest(fields.join(','));
    counter = (counter + 1) & 0x3f;

    return encodeSignature(stub, counter, randomInt(2) === 1, randomInt(255), randomInt(255));
  };
}

export function encodeSignature(
  stub: Uint8Array,
  counter: number,
  flag: boolean,
  payloadRandom: number,
  key: number,
): string {
  const stubDigest = digest(stub);

  const payload = Uint8Array.of(
    counter & 0x3f,
    0,
    1,
    14,
    emptyDigest[14],
    emptyDigest[15],
    stubDigest[14],
    stubDigest[15],
    payloadRandom,
    0,
  );

  payload[9] = payload.reduce((checksum, byte) => checksum ^ byte, 0);

  const bytes = Buffer.from([flag ? 0x50 : 0x40, key, ...legacyStreamCipher(payload, key)]);

  return bytes.toString('base64').replaceAll(/[A-Za-z0-9+/]/g, char => {
    return webcastAlphabet[base64Alphabet.indexOf(char)];
  });
}

function legacyStreamCipher(input: Uint8Array, key: number): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let position = 0;

  for (let index = 0; index < state.length; index++) {
    position = (position + state[index] + key) & 0xff;
    [state[index], state[position]] = [state[position], state[index]];
  }

  let index = 0;
  position = 0;

  return input.map(byte => {
    index = (index + 1) & 0xff;
    position = (position + state[index]) & 0xff;
    [state[index], state[position]] = [state[position], state[index]];

    return byte ^ state[(state[index] + state[position]) & 0xff];
  });
}
