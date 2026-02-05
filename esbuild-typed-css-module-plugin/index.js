// @ts-check
const path = require("node:path");
const fs = require("node:fs/promises"); // for esbuild's fs
const Glob = require("glob"); // Still useful for initial globbing

// Re-use existing modules
const { writeDeclarationAndMapFile } = require("./declaration-writer");
const modularize = require("./modularize"); // Re-use modularize logic
const { renderFieldName } = require("./js-syntax"); // Re-use js-syntax
const SourceFileBuilder = require("./source-file-builder"); // Re-use SourceFileBuilder

/**
 * @typedef {import("./schema-type").Schema} Schema
 * @typedef {Readonly<import("./schema-type").SchemaType<typeof optionsSchema>>} PluginOptions
 * @typedef {Required<PluginOptions>} FilledPluginOptions
 */
// ... optionsSchema, mapGlobFiles (can potentially be reused if fs is adapted)

module.exports = function typedCssModulePlugin(options = {}) {
    // Validate options
    const { pattern = "**/*.module.css" } = options;
    const filledOptions = { pattern };

    return {
        name: "typed-css-module",
        setup(build) {
            const logger = build.onLog ? build.onLog : console; // Use esbuild's logger if available
            const esbuildFs = fs; // Directly use node:fs/promises

            // Adapt Globals for esbuild context.
            // The Globals.fill function in globals.js expects a specific structure for fs.
            // We need to provide a compatible object.
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

            const rootPath =
                build.initialOptions.absWorkingDir || process.cwd();
            // const filter = createFilter([filledOptions.pattern], null, { resolve: rootPath }); // For more complex glob patterns

            // 1. Initial Type Generation)
            build.onStart(async () => {
                logger.info(
                    `[typed-css-module] Starting initial type generation for pattern: '${filledOptions.pattern}'`,
                );
                const files = Glob.sync(filledOptions.pattern, {
                    cwd: rootPath,
                    absolute: true,
                    ignore: "node_modules/**", // Assuming node_modules should be ignored
                    // Glob.sync should use this as its base.
                });

                await Promise.all(
                    files.map(async (filePath) => {
                        logger.debug(
                            `[typed-css-module] Generating declaration file for '${filePath}'`,
                        );
                        const fileContent = await esbuildFs.readFile(
                            filePath,
                            "utf8",
                        );
                        await writeDeclarationAndMapFile(
                            filePath,
                            fileContent,
                            globals, // Pass adapted globals
                        );
                    }),
                );
            });

            // 2. On-demand CSS Module processing and Type Generation
            // This hook will handle both generating the .d.ts file AND providing the JS module content for esbuild.
            // The filter /\.module\.css$/ matches files that are considered CSS modules.
            build.onLoad({ filter: /\.module\.css$/ }, async (args) => {
                logger.debug(
                    `[typed-css-module] Processing CSS module for '${args.path}'`,
                );
                const cssContents = await esbuildFs.readFile(args.path, "utf8");

                // Generate .d.ts file (re-using existing logic)
                await writeDeclarationAndMapFile(
                    args.path,
                    cssContents,
                    globals,
                );

                // Process CSS content using modularize.js
                const { newCssText, nameToSymbol } = modularize(cssContents);

                // Generate JS module content (adapted from loader.js)
                const f = new SourceFileBuilder();
                const writeNamesExpression = (declarationNameKind) => {
                    let hasDeclaration = false;
                    for (const { nameKind } of nameToSymbol.values()) {
                        if (nameKind === declarationNameKind) {
                            hasDeclaration = true;
                            break;
                        }
                    }
                    if (!hasDeclaration) {
                        f.write(`{}`);
                    } else {
                        f.writeLine(`{`);
                        for (const [
                            className,
                            { nameKind, uniqueId },
                        ] of nameToSymbol) {
                            if (nameKind !== declarationNameKind) continue;

                            f.write(`    `)
                                .write(renderFieldName(className))
                                .write(": ")
                                .write(JSON.stringify(uniqueId))
                                .writeLine(",");
                        }
                        f.write(`}`);
                    }
                };

                f.write(`export const cssText = `)
                    .write(JSON.stringify(newCssText))
                    .writeLine(`;`);

                f.write(`export const variables = `);
                writeNamesExpression("variable");
                f.writeLine(`;`);

                f.write(`export default `);
                writeNamesExpression("class");
                f.writeLine(`;`);

                return {
                    contents: f.toString(),
                    loader: "js", // Tell esbuild to treat this as a JavaScript module
                };
            });
        },
    };
};
