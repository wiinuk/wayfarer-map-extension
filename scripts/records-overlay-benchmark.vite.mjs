import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "bench",
    "records-overlay",
);

export default {
    root,
    plugins: [
        {
            name: "records-overlay-benchmark-glsl",
            enforce: "pre",
            async load(id) {
                const filePath = id.split("?")[0];
                if (!filePath || !/\.(vert|frag)$/.test(filePath)) return;
                const source = await readFile(filePath, "utf8");
                return `export const source = ${JSON.stringify(source)}; export default { source };`;
            },
        },
    ],
    server: {
        host: "127.0.0.1",
        port: 4178,
        strictPort: true,
    },
};
