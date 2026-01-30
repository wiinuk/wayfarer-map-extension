import * as esbuild from 'esbuild';
import * as fs from 'fs/promises';

const mainFile = './main.user.ts';

async function build() {
  const mainContent = await fs.readFile(mainFile, 'utf-8');
  const headerMatch = mainContent.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
  if (!headerMatch) {
    throw new Error('Userscript header not found in main.user.ts');
  }
  const banner = headerMatch[0];

  await esbuild.build({
    entryPoints: [mainFile],
    bundle: true,
    outfile: './main.user.js',
    banner: {
      js: banner,
    },
  });
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
