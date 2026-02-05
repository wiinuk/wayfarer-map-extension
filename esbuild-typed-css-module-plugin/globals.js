//@ts-check

const nodeFs = require("node:fs");

/**
 * @typedef {Object} FilledGlobals
 * @property {Console} console
 * @property {GlobalFs} fs
 *
 * @typedef {Partial<FilledGlobals>} Globals
 */

/**
 * @typedef {import("fs")} GlobalFs
 * @property {(path: string) => Promise<Buffer | string>} readFile
 * @property {(path: string, contents: Buffer | string) => Promise<void>} writeFile
 */

/**
 * @param {Globals} globals
 * @return {FilledGlobals}
 */
exports.fill = ({ fs = nodeFs, console = globalThis.console }) => ({
    fs,
    console,
});
