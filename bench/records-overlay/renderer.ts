import type * as PixiTypes from "pixi.js";
import { createZeroPoint, latLngToWorldPoint } from "../../source/geometry";
import { createTypedShaderFrom } from "../../source/typed-pixi-shader";
import CellVertex from "../../source/records-overlay/cell.vert";
import CellFragment from "../../source/records-overlay/cell.frag";
import CircleVertex from "../../source/records-overlay/circle.vert";
import CircleFragment from "../../source/records-overlay/circle.frag";
import {
    newCellMeshBuilder,
    type CellMeshBuilder,
} from "../../source/records-overlay/cell-mesh-builder";
import {
    newCirclesMeshBuilder,
    type CirclesMeshBuilder,
} from "../../source/records-overlay/circles-mesh-builder";
import { createOverlayViewOptions } from "../../source/records-overlay/options";

const PIXI = await import("pixi.js");
const canvasElement = document.querySelector<HTMLCanvasElement>(
    "#benchmark-canvas",
);
if (!canvasElement) throw new Error("Benchmark canvas was not found");
const canvas: HTMLCanvasElement = canvasElement;

const width = 1280;
const height = 800;
const zoom = 18;
const scale = 2 ** zoom;
const rowCount = 8;
const columnCount = 12;
const cellCount = rowCount * columnCount;
const markersPerCell = 12;
const labelsPerCell = 8;
const options = createOverlayViewOptions();
const cellCenterLatStep = 0.045;
const cellCenterLngStep = 0.045;
const cellHalfSize = 0.021;

const app = new PIXI.Application();

function createCell17Corners(
    centerLat: number,
    centerLng: number,
    row: number,
    column: number,
) {
    const latOffset = (row - 0.5) * cellHalfSize;
    const lngOffset = (column - 0.5) * cellHalfSize;
    const lat = centerLat + latOffset;
    const lng = centerLng + lngOffset;
    const halfSize = cellHalfSize / 2;
    return [
        { lat: lat - halfSize, lng: lng - halfSize },
        { lat: lat - halfSize, lng: lng + halfSize },
        { lat: lat + halfSize, lng: lng + halfSize },
        { lat: lat + halfSize, lng: lng - halfSize },
    ] as const;
}

function addCellMeshes(
    layer: PixiTypes.Container,
    builders: readonly CellMeshBuilder[],
) {
    for (const builder of builders) {
        layer.addChild(builder.bake());
    }
}

function addCircleMeshes(
    layer: PixiTypes.Container,
    builders: readonly CirclesMeshBuilder[],
) {
    for (const builder of builders) {
        layer.addChild(builder.bake());
    }
}

async function createScene() {
    const setupStartedAt = performance.now();
    await app.init({
        canvas,
        width,
        height,
        autoDensity: false,
        autoStart: false,
        backgroundAlpha: 0,
        antialias: true,
        roundPixels: true,
        preference: "webgl",
    });

    const shader = createTypedShaderFrom(
        PIXI,
        CellVertex,
        CellFragment,
        new PIXI.UniformGroup({}),
    );
    const circleShader = createTypedShaderFrom(
        PIXI,
        CircleVertex,
        CircleFragment,
        new PIXI.UniformGroup({}),
    );
    const renderer = {
        PIXI,
        shader,
        circleShader,
        _point_result_cache: createZeroPoint(),
    };

    const worldContainer = app.stage.addChild(new PIXI.Container());
    const cellLayer = worldContainer.addChild(
        new PIXI.Container(),
    );
    const circleLayer = worldContainer.addChild(
        new PIXI.Container(),
    );
    const labelLayer = worldContainer.addChild(
        new PIXI.Container(),
    );
    const cellBuilders: CellMeshBuilder[] = [];
    const circleBuilders: CirclesMeshBuilder[] = [];
    const labelStyle = new PIXI.TextStyle({
        fontFamily: `"Helvetica Neue", Arial, sans-serif`,
        fontSize: 11,
        fill: options.wayspotLabelOptions.fillColor,
        stroke: {
            color: options.wayspotLabelOptions.strokeColor,
            width: options.wayspotLabelOptions.strokeWeight,
            join: options.wayspotLabelOptions.lineJoin,
        },
        dropShadow: {
            alpha: 1,
            angle: 0,
            distance: 0,
            color: options.wayspotLabelOptions.strokeColor,
            blur: options.wayspotLabelOptions.shadowBlur,
        },
    });

    for (let row = 0; row < rowCount; row++) {
        for (let column = 0; column < columnCount; column++) {
            const centerLat = (row - (rowCount - 1) / 2) * cellCenterLatStep;
            const centerLng =
                (column - (columnCount - 1) / 2) * cellCenterLngStep;
            const center = latLngToWorldPoint(
                centerLat,
                centerLng,
                createZeroPoint(),
            );
            const cellBuilder = newCellMeshBuilder(renderer, center);
            const circleBuilder = newCirclesMeshBuilder(renderer, center);
            cellBuilders.push(cellBuilder);
            circleBuilders.push(circleBuilder);

            for (let subRow = 0; subRow < 2; subRow++) {
                for (let subColumn = 0; subColumn < 2; subColumn++) {
                    cellBuilder.add(
                        createCell17Corners(
                            centerLat,
                            centerLng,
                            subRow,
                            subColumn,
                        ),
                        options.cell17EmptyOptions,
                        1,
                    );
                }
            }
            cellBuilder.add(
                [
                    {
                        lat: centerLat - cellHalfSize,
                        lng: centerLng - cellHalfSize,
                    },
                    {
                        lat: centerLat - cellHalfSize,
                        lng: centerLng + cellHalfSize,
                    },
                    {
                        lat: centerLat + cellHalfSize,
                        lng: centerLng + cellHalfSize,
                    },
                    {
                        lat: centerLat + cellHalfSize,
                        lng: centerLng - cellHalfSize,
                    },
                ],
                options.cell14Options1,
                1,
            );

            for (let marker = 0; marker < markersPerCell; marker++) {
                const markerRow = Math.floor(marker / 4);
                const markerColumn = marker % 4;
                circleBuilder.add(
                    {
                        lat:
                            centerLat +
                            (markerRow - 1) * cellHalfSize * 0.45,
                        lng:
                            centerLng +
                            (markerColumn - 1.5) * cellHalfSize * 0.45,
                    },
                    options.wayspotOptions.markerSize,
                    options.wayspotOptions,
                    1,
                );
            }

            for (let label = 0; label < labelsPerCell; label++) {
                const labelLat =
                    centerLat + ((label % 2) - 0.5) * cellHalfSize * 0.8;
                const labelLng =
                    centerLng + (Math.floor(label / 2) - 1.5) * cellHalfSize * 0.8;
                const position = latLngToWorldPoint(
                    labelLat,
                    labelLng,
                    createZeroPoint(),
                );
                const text = new PIXI.Text({
                    text: `POI ${row * columnCount + column}-${label}`,
                    style: labelStyle,
                });
                text.anchor.set(0.5, 0.5);
                text.position.set(position.x, position.y);
                labelLayer.addChild(text);
            }
        }
    }

    addCellMeshes(cellLayer, cellBuilders);
    addCircleMeshes(circleLayer, circleBuilders);

    const center = latLngToWorldPoint(0, 0, createZeroPoint());
    worldContainer.scale.set(scale);
    worldContainer.position.set(
        width / 2 - center.x * scale,
        height / 2 - center.y * scale,
    );
    labelLayer.scale.set(1 / scale);

    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("PixiJS did not create a WebGL2 context");

    return {
        gl,
        setupMilliseconds: performance.now() - setupStartedAt,
        counts: {
            cells: cellCount,
            cellMeshes: cellLayer.children.length,
            circleMeshes: circleLayer.children.length,
            markers: cellCount * markersPerCell,
            labels: labelLayer.children.length,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            zoom,
        },
    };
}

function percentile(samples: number[], fraction: number) {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

async function getCanvasHash() {
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new Error("Could not read the rendered canvas"));
        }, "image/png");
    });
    const bitmap = await createImageBitmap(blob);
    const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = snapshot.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Could not read the rendered Canvas pixels");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(
        0,
        0,
        snapshot.width,
        snapshot.height,
    ).data;
    let nonTransparentPixels = 0;
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 0) nonTransparentPixels++;
    }
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(pixels));
    return {
        sha256: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
        ).join(""),
        nonTransparentPixels,
    };
}

async function runBenchmark() {
    const scene = await createScene();
    for (let i = 0; i < 10; i++) {
        app.render();
        scene.gl.finish();
    }

    const submitSamples: number[] = [];
    const completedSamples: number[] = [];
    for (let i = 0; i < 40; i++) {
        const startedAt = performance.now();
        app.render();
        const submittedAt = performance.now();
        scene.gl.finish();
        const completedAt = performance.now();
        submitSamples.push(submittedAt - startedAt);
        completedSamples.push(completedAt - startedAt);
    }

    app.render();
    scene.gl.finish();
    const firstHash = await getCanvasHash();
    app.render();
    scene.gl.finish();
    const secondHash = await getCanvasHash();
    const webglVersion = scene.gl.getParameter(scene.gl.VERSION);
    const webglRenderer =
        scene.gl.getParameter(scene.gl.RENDERER) ?? "unknown";
    app.destroy(true);

    if (firstHash.sha256 !== secondHash.sha256) {
        throw new Error("Repeated Canvas renders produced different pixels");
    }
    if (firstHash.nonTransparentPixels === 0) {
        throw new Error("Canvas render produced a fully transparent image");
    }

    return {
        browser: navigator.userAgent,
        webgl: {
            version: webglVersion,
            renderer: webglRenderer,
        },
        setupMilliseconds: Number(scene.setupMilliseconds.toFixed(3)),
        renderSubmitMilliseconds: {
            median: Number(percentile(submitSamples, 0.5).toFixed(3)),
            p95: Number(percentile(submitSamples, 0.95).toFixed(3)),
        },
        renderAndGpuFinishMilliseconds: {
            median: Number(percentile(completedSamples, 0.5).toFixed(3)),
            p95: Number(percentile(completedSamples, 0.95).toFixed(3)),
        },
        pixelSha256: firstHash.sha256,
        nonTransparentPixels: firstHash.nonTransparentPixels,
        repeatedRenderMatches: true,
        ...scene.counts,
    };
}

declare global {
    interface Window {
        runRecordsOverlayBenchmark: typeof runBenchmark;
        recordsOverlayBenchmarkReady: boolean;
    }
}

window.runRecordsOverlayBenchmark = runBenchmark;
window.recordsOverlayBenchmarkReady = true;
