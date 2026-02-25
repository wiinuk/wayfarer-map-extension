//@ts-check
import { defineConfig, globalIgnores } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import js from "@eslint/js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { FlatCompat } from "@eslint/eslintrc";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

/**
 * @param {string} dirPath
 * @returns {import("@eslint/core").Plugin}
 */
function loadLocalRulesAsPlugin(dirPath) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const rulesDir = path.join(__dirname, dirPath);

    /** @type {Record<string, import("@eslint/core").RuleDefinition>} */
    const rules = Object.create(null);
    for (const file of fs.readdirSync(rulesDir)) {
        if (!file.endsWith(".js")) continue;

        const ruleName = path.basename(file, ".js");
        const ruleModule = require(path.join(rulesDir, file));
        rules[ruleName] = ruleModule.default || ruleModule;
    }
    return { rules };
}

export default defineConfig([
    {
        languageOptions: {
            parser: tsParser,

            globals: {
                ...globals.node,
                ...globals.browser,
            },

            ecmaVersion: 2021,
            sourceType: "module",
            parserOptions: { projectService: true },
        },

        plugins: {
            "@typescript-eslint": /** @type {import("@eslint/core").Plugin} */ (
                /** @type {unknown} */ (typescriptEslint)
            ),
            local: loadLocalRulesAsPlugin("./eslint/rules"),
        },

        extends: compat.extends(
            "eslint:recommended",
            "plugin:@typescript-eslint/recommended",
        ),
        rules: {
            "@typescript-eslint/no-floating-promises": [
                "warn",
                { ignoreVoid: true },
            ],
            "@typescript-eslint/no-empty-function": "warn",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/no-unnecessary-condition": "warn",
            "@typescript-eslint/no-unnecessary-type-assertion": "warn",

            "object-shorthand": "warn",
            "no-useless-rename": "warn",
            "no-duplicate-imports": "warn",

            "local/no-unused-spell-checker-directive": "warn",
        },
    },
    globalIgnores([
        "**/node_modules/",
        "**/.*",
        "./esbuild-typed-css-module-plugin",
        "./eslint/rules",
        "./build.mjs",
        "./*.config.mjs",
        "./*.user.js",
        "./*.debug.js",
        "./shims/",
    ]),
]);
