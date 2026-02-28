// esbuild-glsl-plugin/index.js
import { readFile } from 'fs/promises';
import { parseShader } from './parser.js';
import fs from "node:fs/promises"; // for esbuild's fs
import { writeDeclaration } from './declaration-writer.js';

const glslPlugin = (options = {}) => ({
  name: 'glsl',
  setup(build) {
    const logger = build.onLog ? build.onLog : console;
    build.onLoad({ filter: /\.(vert|frag)$/ }, async (args) => {
      const sourceText = await readFile(args.path, 'utf8');
      const { uniforms: uniforms_owner, attributes: attributes_owner } = parseShader(sourceText);
      const esbuildFs = fs; // Directly use node:fs/promises

      const uniforms = Object.fromEntries(uniforms_owner.map(x=>[x,x]));
      const attributes = Object.fromEntries(attributes_owner.map(x=>[x,x]));
      const globals = {
          console: logger,
          fs: {
              readFile: {
                  __promisify__: async (filePath) => {
                      const content = await esbuildFs.readFile(
                          filePath,
                          "utf8",
                      );
                      return { toString: () => content };
                  },
              },
              writeFile: esbuildFs.writeFile, // Assuming writeFile takes (path, content)
          },
      };

      // 型定義ファイルを非同期で書き出す
      await writeDeclaration(args.path, Object.keys(uniforms), Object.keys(attributes), globals);

      const contents = `
        export const source = ${JSON.stringify(sourceText)};
        export const uniforms = ${JSON.stringify(uniforms)};
        export const attributes = ${JSON.stringify(attributes)};
      `;

      return {
        contents,
        loader: 'js',
      };
    });
  },
});

export default glslPlugin;
