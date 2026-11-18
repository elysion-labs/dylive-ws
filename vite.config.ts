import { byc } from '@byc/vp-config';

export default byc(
  {
    pack: {
      entry: {
        index: 'src/index.ts',
        protocol: 'src/protocol.ts',
        parser: 'src/parser.ts',
        electron: 'src/electron.ts',
      },
      platform: 'node',
      format: 'esm',
      dts: { tsconfig: 'tsconfig.build.json' },
      sourcemap: true,
      clean: true,
    },
  },
  { stylistic: true },
);
