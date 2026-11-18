export type Fetcher = (url: string | URL, options?: RequestInit) => Promise<Response>;

export type CookieSource =
  | string
  | ((signal: AbortSignal) => string | null | undefined | Promise<string | null | undefined>);

interface RoomConnection {
  roomId: string;
  url: string;
  headers: Record<string, string>;
}

interface ResolveOptions {
  webRoomId: string;
  cookie: string;
  fetch: Fetcher;
  signal: AbortSignal;
  sign: (query: URLSearchParams) => string;
}

const liveOrigin = 'https://live.douyin.com';
const webcastEndpoint = 'wss://webcast100-ws-web-lf.douyin.com/webcast/im/push/v2/';

const browserVersion =
  '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const sdkVersion = '1.0.15';

const requestHeaders = {
  'user-agent': `Mozilla/${browserVersion}`,
  referer: `${liveOrigin}/`,
};

export async function resolveConnection(options: ResolveOptions): Promise<RoomConnection> {
  const pageUrl = new URL(`/${options.webRoomId}`, liveOrigin);

  const headers = options.cookie ? { ...requestHeaders, cookie: options.cookie } : requestHeaders;

  let response: Response;

  try {
    response = await options.fetch(pageUrl, {
      headers,
      signal: options.signal,
      redirect: 'error',
    });
  } catch {
    throw new Error('Could not request the Douyin live room page');
  }

  if (!response.ok) {
    throw new Error(`Douyin live room page returned HTTP ${response.status}`);
  }

  const page = readLivePage(await response.text(), options.webRoomId);
  const cookie = sessionCookie(options.cookie, response.headers);
  const url = buildSocketUrl(page, options.sign);

  return {
    roomId: page.roomId,
    url,
    headers: { ...requestHeaders, origin: liveOrigin, ...(cookie ? { cookie } : {}) },
  };
}

export function readLivePage(html: string, webRoomId: string): { roomId: string; userId: string } {
  // 抖音直播间将 SSR 状态装在带转义的脚本字符串中。
  const state = html.replaceAll(/\\+"/g, '"');

  const room =
    /"roomInfo"\s*:\s*\{\s*"room"\s*:\s*\{\s*"id_str"\s*:\s*"([1-9]\d*)"\s*,\s*"status"\s*:\s*(\d+)/.exec(
      state,
    );

  const adjacentRoom = /"roomId"\s*:\s*"([1-9]\d*)"\s*,\s*"web_rid"\s*:\s*"([1-9]\d*)"/g;
  const matched = [...state.matchAll(adjacentRoom)].find(match => match[2] === webRoomId);
  const roomId = matched?.[1] ?? room?.[1];

  if (!roomId) {
    throw new Error('Douyin live room page did not return an internal room ID');
  }

  if (room && room[1] === roomId && room[2] === '4') {
    throw new Error('Douyin live room is offline');
  }

  const userId = /"user_unique_id"\s*:\s*"?([1-9]\d*)/.exec(state)?.[1];

  if (!userId) {
    throw new Error('Douyin live room page did not return a viewer ID');
  }

  return { roomId, userId };
}

function sessionCookie(cookie: string, headers: Headers): string {
  if (/(?:^|;\s*)ttwid=/.test(cookie)) {
    return cookie;
  }

  const guest = headers
    .getSetCookie()
    .find(value => value.startsWith('ttwid='))
    ?.split(';', 1)[0];

  if (!guest) {
    return cookie;
  }

  return cookie ? `${cookie}; ${guest}` : guest;
}

function buildSocketUrl(
  { roomId, userId }: { roomId: string; userId: string },
  sign: ResolveOptions['sign'],
): string {
  const url = new URL(webcastEndpoint);
  const now = Date.now();

  url.search = new URLSearchParams({
    app_name: 'douyin_web',
    version_code: '180800',
    webcast_sdk_version: sdkVersion,
    update_version_code: sdkVersion,
    compress: 'gzip',
    device_platform: 'web',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Mozilla',
    browser_version: browserVersion,
    browser_online: 'true',
    tz_name: 'Asia/Shanghai',
    cursor: `d-1_u-1_fh-0_t-${now}_r-1`,
    internal_ext: `internal_src:dim|wss_push_room_id:${roomId}|wss_push_did:${userId}|first_req_ms:${now}|fetch_time:${now}|seq:1|wss_info:0-${now}-0-0`,
    host: liveOrigin,
    aid: '6383',
    live_id: '1',
    did_rule: '3',
    endpoint: 'live_pc',
    support_wrds: '1',
    user_unique_id: userId,
    im_path: '/webcast/im/fetch/',
    identity: 'audience',
    need_persist_msg_count: '15',
    insert_task_id: '',
    live_reason: '',
    room_id: roomId,
    heartbeatDuration: '0',
  }).toString();
  url.searchParams.set('signature', sign(url.searchParams));

  return url.href;
}
