import { defineConfig, globalIgnores } from "eslint/config";

import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import js from "@eslint/js";
import path from "path";
import { fileURLToPath } from "url";

import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

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
            "@typescript-eslint": typescriptEslint,
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
        },
    },
    globalIgnores([
        "**/node_modules/",
        "**/.*",
        "./esbuild-typed-css-module-plugin",
        "./build.mjs",
        "./*.config.mjs",
        "./*.user.js",
        "./*.debug.js",
        "./shims/",
    ]),
]);
