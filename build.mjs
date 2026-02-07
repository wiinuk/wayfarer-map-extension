//@ts-check
import * as esbuild from "esbuild";
import * as fs from "fs/promises";
import { exec } from "child_process";
import path from "path";
import workerPlugin from "esbuild-plugin-inline-worker";
import TypedCssModulePlugin from "./esbuild-typed-css-module-plugin/index.js";

const mainFile = "./wayfarer-map-extension.user.ts";
const args = process.argv.slice(2);
const watchMode = args.includes("--watch");
const debugMode = args.includes("--debug");
const wsHost = process.env.WS_HOST || "127.0.0.1";
const wsPort = Number(process.env.WS_PORT || 35729);

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
    if (debugMode) {
        wss = await startWsServer();
    }

    const clientSnippet = debugMode
        ? `;(function(){try{let connected = false; var ws=new WebSocket('ws://${wsHost}:${wsPort}');ws.addEventListener('open', () => {connected = true;});ws.addEventListener('message',function(e){if(e.data==='reload')location.reload();});ws.addEventListener('close',function(){if(connected){setTimeout(function(){location.reload();},100);}} );}catch(e){console.warn('dev reload ws failed',e);} })();`
        : "";

    /** @type {esbuild.BuildOptions} */
    const baseOptions = {
        entryPoints: [mainFile],
        bundle: true,
        outfile: changeExt(
            mainFile,
            debugMode || watchMode ? ".debug.js" : ".js",
        ),
        banner: { js: banner },
        footer: debugMode ? { js: clientSnippet } : undefined,
        sourcemap: debugMode ? "inline" : false,
        plugins: [TypedCssModulePlugin(), workerPlugin()],
    };

    if (watchMode) {
        // esbuild version in this project doesn't support `watch` option reliably.
        // Use chokidar to watch files and re-run a build on changes.
        const { watch } = await import("chokidar");
        let building = false;
        let scheduled = false;

        const runBuild = async () => {
            if (building) {
                scheduled = true;
                return;
            }
            building = true;
            try {
                if (!debugMode) {
                    const lintPassed = await runEslint();
                    if (!lintPassed) {
                        console.error("Build aborted due to linting errors.");
                        return;
                    }
                    const tscPassed = await runTsc();
                    if (!tscPassed) {
                        console.error("Build aborted due to TypeScript errors.");
                        return;
                    }
                }

                await esbuild.build(baseOptions);
                console.log("Build succeeded");
                if (wss) {
                    try {
                        for (const c of wss.clients) c.send("reload");
                    } catch (e) {}
                }
            } catch (err) {
                console.error("Build failed:", err);
            } finally {
                building = false;
                if (scheduled) {
                    scheduled = false;
                    runBuild();
                }
            }
        };

        // initial build
        await runBuild();

        const watcher = watch([mainFile, "./source/**/*"], {
            ignoreInitial: true,
        });
        watcher.on("all", (ev, path) => {
            console.log("[dev] file change", ev, path);
            runBuild();
        });
        console.log("Watching for changes...");
        // keep process alive
        process.stdin.resume();
    } else {
        const lintPassed = await runEslint();
        if (!lintPassed) {
            console.error("Build aborted due to linting errors.");
            process.exit(1);
        }
        const tscPassed = await runTsc();
        if (!tscPassed) {
            console.error("Build aborted due to TypeScript errors.");
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
