//spell-checker:words Antlr Userscript
//@ts-check
import * as esbuild from "esbuild";
import * as fs from "fs/promises";
import { exec } from "child_process";
import path from "path";
import workerPlugin from "esbuild-plugin-inline-worker";
import TypedCssModulePlugin from "./esbuild-typed-css-module-plugin/index.js";
import glslPlugin from "./esbuild-glsl-plugin/index.js";
import chokidar from "chokidar";

const mainFile = "./wayfarer-map-extension.user.ts";
const args = process.argv.slice(2);
const watchMode = args.includes("--watch");
const wsHost = process.env.WS_HOST || "127.0.0.1";
const wsPort = Number(process.env.WS_PORT || 35729);

async function runAntlr() {
    console.log("[antlr] Running antlr4ts...");
    return new Promise((resolve) => {
        exec(
            "cd source/sal && npx antlr4ts -visitor Sal.g4 -o .antlr-generated",
            (error, stdout, stderr) => {
                if (stdout) console.log(stdout);
                if (stderr) console.error(stderr);
                if (error) {
                    console.error("[antlr] antlr4ts found errors!");
                    resolve(false);
                } else {
                    console.log("[antlr] antlr4ts passed.");
                    resolve(true);
                }
            },
        );
    });
}

async function runEslint() {
    console.log("[lint] Running ESLint...");
    return new Promise((resolve) => {
        exec("eslint", (error, stdout, stderr) => {
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            if (error) {
                console.error("[lint] ESLint found errors!");
                resolve(false);
            } else {
                console.log("[lint] ESLint passed.");
                resolve(true);
            }
        });
    });
}

async function runTsc() {
    console.log("[tsc] Running TypeScript compiler...");
    return new Promise((resolve) => {
        exec("tsc --noEmit", (error, stdout, stderr) => {
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            if (error) {
                console.error("[tsc] TypeScript found errors!");
                resolve(false);
            } else {
                console.log("[tsc] TypeScript passed.");
                resolve(true);
            }
        });
    });
}

async function runVitest() {
    console.log("[test] Running vitest...");
    return new Promise((resolve) => {
        exec("vitest run", (error, stdout, stderr) => {
            if (stdout) console.log(stdout);
            if (stderr) console.error(stderr);
            if (error) {
                console.error("[test] vitest found errors!");
                resolve(false);
            } else {
                console.log("[test] vitest passed.");
                resolve(true);
            }
        });
    });
}

async function startWsServer() {
    try {
        const { WebSocketServer } = await import("ws");
        const wss = new WebSocketServer({ host: wsHost, port: wsPort });
        wss.on("connection", () => {
            console.log("[dev] ws client connected");
        });
        console.log(
            `[dev] WebSocket server listening on ws://${wsHost}:${wsPort}`,
        );
        return wss;
    } catch (e) {
        console.error("[dev] failed to start ws server:", e);
        return null;
    }
}

/**
 * @param {string} originalPath
 * @param {string} newExt
 */
function changeExt(originalPath, newExt) {
    const parsedPath = path.parse(originalPath);
    parsedPath.ext = newExt;
    parsedPath.base = "";
    return path.format(parsedPath);
}

async function build() {
    const mainContent = await fs.readFile(mainFile, "utf-8");
    const headerMatch = mainContent.match(
        /\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/,
    );
    if (!headerMatch) {
        throw new Error(`Userscript header not found in ${mainFile}`);
    }
    const banner = headerMatch[0];

    let wss = null;
    if (watchMode) {
        wss = await startWsServer();
    }

    const clientSnippet = watchMode
        ? `;(function(){try{let connected = false; var ws=new WebSocket('ws://${wsHost}:${wsPort}');ws.addEventListener('open', () => {connected = true;});ws.addEventListener('message',function(e){if(e.data==='reload')location.reload();});ws.addEventListener('close',function(){if(connected){setTimeout(function(){location.reload();},100);}} );}catch(e){console.warn('dev reload ws failed',e);} })();`
        : "";

    /** @type {esbuild.Plugin} */
    const cleanupPlugin = {
        name: "build-notifier",
        setup(build) {
            build.onStart(() => {
                console.log("[esbuild] building...");
            });
            build.onEnd((result) => {
                if (result.errors.length > 0) {
                    console.error("[esbuild] build failed:", result.errors);
                } else {
                    console.log("[esbuild] build succeeded");
                    if (wss) {
                        for (const c of wss.clients) {
                            c.send("reload");
                        }
                    }
                }
            });
        },
    };

    /** @type {esbuild.BuildOptions} */
    const baseOptions = {
        entryPoints: [mainFile],
        bundle: true,
        outfile: changeExt(mainFile, watchMode ? ".debug.js" : ".js"),
        banner: { js: banner },
        footer: watchMode ? { js: clientSnippet } : undefined,
        sourcemap: watchMode ? "inline" : false,
        plugins: [glslPlugin(), TypedCssModulePlugin(), workerPlugin(), cleanupPlugin],
        alias: {
            assert: "./shims/assert.js",
            util: "./shims/util.js",
        },
    };

    if (watchMode) {
        const context = await esbuild.context(baseOptions);
        await runAntlr();
        await context.watch({
            delay: 3000,
        });
        console.log("Watching for changes...");
        const watcher = chokidar.watch("source/sal/Sal.g4", {
            persistent: true,
        });

        watcher.on("change", async (path) => {
            console.log(`[watcher] File ${path} has been changed.`);
            await runAntlr();
        });
    } else {
        const antlrPassed = await runAntlr();
        if (!antlrPassed) {
            console.error("Build aborted due to antlr4ts errors.");
            process.exit(1);
        }
        const tscPassed = await runTsc();
        if (!tscPassed) {
            console.error("Build aborted due to TypeScript errors.");
            process.exit(1);
        }
        const lintPassed = await runEslint();
        if (!lintPassed) {
            console.error("Build aborted due to linting errors.");
            process.exit(1);
        }
        const testPassed = await runVitest();
        if (!testPassed) {
            console.error("Build aborted due to test errors.");
            process.exit(1);
        }
        await esbuild.build(baseOptions);
        if (wss) {
            try {
                for (const c of wss.clients) c.send("reload");
            } catch (e) {}
            wss.close();
        }
    }
}

build().catch((e) => {
    console.error(e);
    process.exit(1);
});
