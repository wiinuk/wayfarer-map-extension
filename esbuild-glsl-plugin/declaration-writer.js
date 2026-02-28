// @ts-check
const { SourceMapGenerator } = require("source-map");
const { renderFieldName } = require("./js-syntax");
const SourceFileBuilder = require("./source-file-builder");
const Globals = require("./globals");

/**
 * @param {Globals.GlobalFs} fs
 * @param {string} path
 * @param {string} contents
 */
const writeIfChanged = async (fs, path, contents) => {
    /** @type {string | undefined} */
    let oldContents;
    try {
        oldContents = (await fs.readFile.__promisify__(path)).toString();
    } catch {}

    if (oldContents === contents) {
        return;
    }
    await fs.writeFile(path, contents);
};

/**
 * @typedef {{
*   name: string;
*   start: { line: number; character: number; };
*   end: { line: number; character: number; };
* }} ShaderSymbol
*/

/**
 * @param {string} shaderPath
 * @param {ShaderSymbol[]} uniforms
 * @param {ShaderSymbol[]} attributes
 * @param {Globals.Globals} [globals]
 */
exports.writeDeclaration = async function (
    shaderPath,
    uniforms,
    attributes,
    globals = {},
) {
    const { fs } = Globals.fill(globals);
    const declarationPath = shaderPath + ".d.ts";
    const declarationMapPath = declarationPath + ".map";

    const declarationMap = new SourceMapGenerator({
        file: declarationPath,
    });
    declarationMap.addMapping({
        generated: {
            line: 1,
            column: 0,
        },
        source: shaderPath,
        original: {
            line: 1,
            column: 0,
        },
    });

    const declarationFile = new SourceFileBuilder({
        lineBase: 1,
        columnBase: 0,
    });
    const d = declarationFile;
    d.writeLine(`export const source: string;`);

    /**
     * @param {ShaderSymbol[]} names
     */
    const writeNamesType = (names) => {
        if (names.length === 0) {
            d.write(` Record<string, never>`);
            return;
        }
        for (const symbol of names) {
            d.write(` & { readonly `);
            const startLine = d.line;
            const startColumn = d.column;
            d.write(renderFieldName(symbol.name));
            const endLine = d.line;
            const endColumn = d.column;
            d.write(`: string; }`);

            const cssStart = symbol.start;
            const cssEnd = symbol.end;
            declarationMap.addMapping({
                generated: {
                    line: startLine,
                    column: startColumn,
                },
                source: shaderPath,
                original: {
                    line: cssStart.line + 1,
                    column: cssStart.character,
                },
                name: symbol.name,
            });
            declarationMap.addMapping({
                generated: {
                    line: endLine,
                    column: endColumn,
                },
                source: shaderPath,
                original: {
                    line: cssEnd.line + 1,
                    column: cssEnd.character,
                },
                name: symbol.name,
            });
        }
    };

    d.write(`export const uniforms:`);
    writeNamesType(uniforms);
    d.writeLine(";");

    d.write(`export const attributes:`);
    writeNamesType(attributes);
    d.writeLine(";");
    d.writeLine(`export default source;`);

    await Promise.all([
        writeIfChanged(fs, declarationPath, declarationFile.toString()),
        writeIfChanged(fs, declarationMapPath, declarationMap.toString()),
    ]);
};
