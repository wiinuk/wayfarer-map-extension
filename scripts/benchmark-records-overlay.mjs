import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const vite = await createServer({
    configFile: fileURLToPath(
        new URL("./records-overlay-benchmark.vite.mjs", import.meta.url),
    ),
    logLevel: "error",
});
let browser;

try {
    await vite.listen();
    browser = await chromium.launch({
        headless: true,
        args: [
            "--enable-webgl",
            "--use-gl=angle",
            "--use-angle=swiftshader",
        ],
    });
    const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.goto("http://127.0.0.1:4178/", {
        waitUntil: "networkidle",
    });
    await page.waitForFunction(
        () => window.recordsOverlayBenchmarkReady === true,
    );
    const result = await page.evaluate(() =>
        window.runRecordsOverlayBenchmark(),
    );
    if (pageErrors.length > 0) throw pageErrors[0];
    if (!result.repeatedRenderMatches) {
        throw new Error("Canvas pixel output was not repeatable");
    }
    console.log("[records-overlay playwright benchmark]");
    console.log(JSON.stringify(result, null, 2));
} finally {
    await browser?.close();
    await vite.close();
}
