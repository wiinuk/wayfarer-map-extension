// esbuild-glsl-plugin/index.js
const { readFile } = require('fs/promises');
const { parseShader } = require('./parser.js');
const fs = require("node:fs/promises"); // for esbuild's fs
const { writeDeclaration } = require('./declaration-writer.js');

const glslPlugin = (options = {}) => ({
  name: 'glsl',
  setup(build) {
    const logger = build.onLog ? build.onLog : console;
    build.onLoad({ filter: /\.(vert|frag)$/ }, async (args) => {
      const sourceText = await readFile(args.path, 'utf8');
      const { uniforms, attributes } = parseShader(sourceText);
      const esbuildFs = fs; // Directly use node:fs/promises

      const uniformsObj = Object.fromEntries(uniforms.map(x=>[x.name,x.name]));
      const attributesObj = Object.fromEntries(attributes.map(x=>[x.name,x.name]));
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
      await writeDeclaration(args.path, uniforms, attributes, globals);

      const contents = `
        export const source = ${JSON.stringify(sourceText)};
        export const uniforms = ${JSON.stringify(uniformsObj)};
        export const attributes = ${JSON.stringify(attributesObj)};
        export default { source, uniforms, attributes };
      `;

      return {
        contents,
        loader: 'js',
      };
    });
  },
});

module.exports = glslPlugin;
