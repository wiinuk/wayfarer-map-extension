//@ts-check
import { it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import * as sourceMap from "source-map-js";
import * as esbuild from "esbuild"; // Import esbuild
import {
    computeLineStarts,
    computeLineAndCharacterOfPosition,
} from "./line-map";
import TypedCssModulePlugin from "./index.js"; // The esbuild plugin

const positionOf = (
    /** @type {string} */ searchString,
    /** @type {string} */ contents,
) => {
    const { line, character } = computeLineAndCharacterOfPosition(
        computeLineStarts(contents),
        contents.indexOf(searchString),
    );
    return { line: line + 1, column: character };
};
/**
 * @param {sourceMap.MappedPosition} position
 */
const normalizeSourcePath = (position) => ({
    ...position,
    source: path.normalize(position.source),
});

it("test", async () => {
    const files = {
        "main.ts": `
            import styles, { cssText } from "./styles.module.css";
            const article = styles.article;
            export { styles, cssText, article };
        `,
        "styles.module.css": `
            .article {
                background-color: #fff;
            }
        `,
        "tsconfig.json": `
            {
                "compilerOptions": {
                    "target": "ES5",
                    "lib": [],
                    "module": "ES2015",
                    "esModuleInterop": true,
                    "sourceMap": true,
                    "strict": true,
                }
            }
        `,
    };
    const entryPath = "main.ts";
    const outputPath = "main.js";

    const tempDirectoryPath = path.resolve(
        await fs.mkdtemp(path.join(__dirname, "_temp_test_")),
    );
    try {
        for (const filePath in files) {
            await fs.writeFile(
                path.join(tempDirectoryPath, filePath),
                files[filePath],
            );
        }
        const outputFilePath = path.join(tempDirectoryPath, outputPath);

        // Esbuild configuration
        const result = await esbuild.build({
            entryPoints: [path.join(tempDirectoryPath, entryPath)],
            bundle: true,
            outfile: outputFilePath,
            platform: "node", // Target node environment
            format: "cjs", // CommonJS output to match original test's require()
            plugins: [TypedCssModulePlugin()], // Use the new esbuild plugin
            absWorkingDir: tempDirectoryPath, // Set working directory for esbuild
            logLevel: "silent", // Suppress esbuild logs during test
            sourcemap: true, // Enable sourcemaps
        });

        expect(result.errors).toStrictEqual([]);
        expect(result.warnings).toStrictEqual([]);

        const declarationContents = (
            await fs.readFile(
                path.join(tempDirectoryPath, "styles.module.css.d.ts"),
            )
        ).toString();
        expect(declarationContents).toContain("article");

        // .d.ts ファイルの中で最初に "article" が現れる位置を取得
        const declarationArticleStart = positionOf(
            "article",
            declarationContents,
        );

        const mapContents = (
            await fs.readFile(
                path.join(tempDirectoryPath, "styles.module.css.d.ts.map"),
            )
        ).toString();
        const consumer = new sourceMap.SourceMapConsumer(
            JSON.parse(mapContents),
        );

        // .d.ts.map の中に記録されている、.d.ts の中の article の位置に対応する .css ファイルの中の位置を得る
        const cssArticleStart = normalizeSourcePath(
            consumer.originalPositionFor(declarationArticleStart),
        );

        // .css ファイルの中の article の位置と一致しているか確認
        const cssArticlePosition = positionOf(
            "article",
            files["styles.module.css"],
        );
        expect(cssArticleStart).toStrictEqual({
            ...cssArticlePosition,
            source: path.normalize(
                path.join(tempDirectoryPath, "styles.module.css"),
            ),
            name: "article",
        });

        const main = require(outputFilePath);
        expect(new Set(Object.keys(main.styles))).toStrictEqual(
            new Set(["article"]),
        );
        expect(main.cssText).toContain(main.styles.article);
    } finally {
        await fs.rm(tempDirectoryPath, { recursive: true });
    }
}, 50000);
