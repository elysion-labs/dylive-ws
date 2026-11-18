/* eslint-disable no-console -- 示例程序直接显示直播间消息。 */
import { createElectronClient } from '@elysionjs/dylive-ws/electron';
import { app, BrowserWindow } from 'electron';

async function main() {
  const [argument] = process.argv.slice(2);

  if (argument === '--help' || argument === '-h') {
    console.log('electron examples/electron.mjs [网页直播间号]');

    return app.exit(0);
  }

  if (argument && !/^[1-9]\d{0,19}$/.test(argument)) {
    throw new Error('请传入网页直播间号');
  }

  const partition = 'dylive-ws-example';

  const webPreferences = {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  };

  await app.whenReady();
  const window = new BrowserWindow({ width: 1200, height: 820, webPreferences });

  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = URL.parse(url);

    if (target?.origin === 'https://live.douyin.com' && /^\/\d+\/?$/.test(target.pathname)) {
      setImmediate(() => {
        void window.loadURL(target.href).catch(error => console.error(error.message));
      });

      return { action: 'deny' };
    }

    if (target?.protocol === 'https:' && target.hostname.endsWith('.douyin.com')) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences } };
    }

    return { action: 'deny' };
  });

  await window.loadURL('about:blank');
  const client = createElectronClient({ webContents: window.webContents });

  client.on('statusChange', state => console.log(state.status));
  client.on('event', event => console.log(event.roomId, event.user.name, event.content));
  client.on('error', error => console.error(error.message));
  window.once('closed', () => {
    void client.dispose().finally(() => app.quit());
  });

  await client.start();
  const url = `https://live.douyin.com/${argument ?? ''}`;
  await window.loadURL(url);
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Electron 示例启动失败');
  app.exit(1);
});
