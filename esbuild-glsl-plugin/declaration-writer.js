// @ts-check
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
 * @param {string} shaderPath
 * @param {string[]} uniforms
 * @param {string[]} attributes
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

    const declarationFile = new SourceFileBuilder({
        lineBase: 1,
        columnBase: 0,
    });
    const d = declarationFile;
    d.writeLine(`export const source: string;`);

    /**
     * @param {string[]} names
     */
    const writeNamesType = (names) => {
        if (names.length === 0) {
            d.write(` Record<string, never>`);
            return;
        }
        for (const name of names) {
            d.write(` & { readonly `);
            d.write(renderFieldName(name));
            d.write(`: string; }`);
        }
    };

    d.write(`export const uniforms:`);
    writeNamesType(uniforms);
    d.writeLine(";");

    d.write(`export const attributes:`);
    writeNamesType(attributes);
    d.writeLine(";");

    await writeIfChanged(fs, declarationPath, declarationFile.toString());
};
