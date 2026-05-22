import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {esbuild.BuildOptions} */
const baseOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const entries = [
  { in: 'webview-ui/src/bookmarkDetail/main.ts', out: 'dist/webview/bookmarkDetail.js' },
  { in: 'webview-ui/src/numberBrowser/main.ts',  out: 'dist/webview/numberBrowser.js' },
  { in: 'webview-ui/src/accountForm/main.ts',    out: 'dist/webview/accountForm.js' },
];

if (watch) {
  const ctxs = await Promise.all(
    entries.map(e => esbuild.context({ ...baseOptions, entryPoints: [e.in], outfile: e.out }))
  );
  await Promise.all(ctxs.map(ctx => ctx.watch()));
  console.log('Watching webview sources...');
} else {
  await Promise.all(
    entries.map(e => esbuild.build({ ...baseOptions, entryPoints: [e.in], outfile: e.out }))
  );
}
