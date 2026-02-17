// spell-checker: ignore Lngs
import {
    isNeedDetail,
    type CircleConfig,
    type DraftId,
    type DraftViews,
    type DraftWithView,
    type PolygonConfig,
    type ViewConfig,
} from "./drafts-overlay";
import type { Reference } from "./standard-extensions";
import { createCellFromCoordinates } from "./typed-s2cell";

type LatLng = google.maps.LatLngLiteral;

function getPixelsPerMeter(
    center: LatLng,
    projection: google.maps.MapCanvasProjection,
) {
    const offsetLatLng = google.maps.geometry.spherical.computeOffset(
        center,
        1,
        0,
    );
    const p1 = projection.fromLatLngToDivPixel(center)!;
    const p2 = projection.fromLatLngToDivPixel(offsetLatLng)!;
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

export type DraftCanvasOverlay = ReturnType<typeof createCanvasOverlay>;
export function createCanvasOverlay(
    drafts: DraftViews,
    config: ViewConfig,
    selectedDraftId: Reference<DraftId | null>,
) {
    class CanvasOverlay extends google.maps.OverlayView {
        private canvas: HTMLCanvasElement | null = null;
        constructor(
            private config: ViewConfig,
            private drafts: DraftViews,
            private selectedDraftId: Reference<DraftId | null>,
        ) {
            super();
        }

        // Overlay が地図に追加された時に呼ばれる
        override onAdd() {
            this.canvas = document.createElement("canvas");
            this.canvas.style.position = "absolute";
            this.canvas.style.pointerEvents = "none";

            const panes = this.getPanes()!;
            panes.markerLayer.appendChild(this.canvas);
        }
        override onRemove() {
            if (this.canvas?.parentNode) {
                this.canvas.parentNode.removeChild(this.canvas);
                this.canvas = null;
            }
        }

        // 地図が動いたりズームしたりする度に呼ばれる
        override draw() {
            const projection = this.getProjection();
            if (!projection) return;

            const map = this.getMap();
            const canvas = this.canvas;
            if (!(map instanceof google.maps.Map) || !canvas) return;

            const bounds = map.getBounds()!;
            const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest())!;
            const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast())!;

            // Canvas のサイズと位置を現在の表示範囲に合わせる
            canvas.style.left = sw.x + "px";
            canvas.style.top = ne.y + "px";
            canvas.width = ne.x - sw.x;
            canvas.height = sw.y - ne.y;
            const deviceX = sw.x;
            const deviceY = ne.y;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // 各POIを描画
            if (!isNeedDetail(map, this.config)) {
                renderDrafts(
                    ctx,
                    this.drafts,
                    this.config.draftMarker,
                    projection,
                    deviceX,
                    deviceY,
                );
            }

            // 選択マーカーの付随UIを描画
            const selected = this.drafts.get(this.selectedDraftId.contents!);
            const config = this.config.selected;
            if (selected) {
                drawSelectedViews(
                    selected,
                    projection,
                    ctx,
                    config,
                    deviceX,
                    deviceY,
                );
            }
        }
    }
    return new CanvasOverlay(config, drafts, selectedDraftId);
}

function drawSelectedViews(
    selected: DraftWithView,
    projection: google.maps.MapCanvasProjection,
    ctx: CanvasRenderingContext2D,
    config: ViewConfig["selected"],
    deviceX: number,
    deviceY: number,
) {
    const center = selected.draft.coordinates[0];
    const pixelsPerMeter = getPixelsPerMeter(center, projection);
    for (const circleKey in config.circles) {
        const circleConfig =
            config.circles[circleKey as keyof typeof config.circles];

        renderCircle(
            ctx,
            center,
            circleConfig,
            projection,
            pixelsPerMeter,
            deviceX,
            deviceY,
        );
    }

    for (const key in config.cell) {
        const cellConfig = config.cell[key as `${number}`]!;
        const level = Number(key);
        const path = createCellFromCoordinates(
            center,
            level,
        ).getCornerLatLngs();
        renderPolygon(ctx, path, cellConfig, projection, deviceX, deviceY);
    }
}

function renderPolygon(
    ctx: CanvasRenderingContext2D,
    path: readonly LatLng[],
    config: PolygonConfig,
    projection: google.maps.MapCanvasProjection,
    deviceX: number,
    deviceY: number,
) {
    const {
        strokeWeight,
        strokeColor,
        dashLength,
        dashRatio,
        fill: needFill,
        fillColor,
    } = config;

    const hasPath = 2 <= path.length;
    const needStroke = 0 < strokeWeight;
    if (!hasPath || (!needStroke && !needFill)) return;

    // パスを作成
    setPath(ctx, path, projection, deviceX, deviceY);

    if (needFill) {
        // 内部を描画
        ctx.fillStyle = fillColor;
        ctx.fill();
    }

    if (needStroke) {
        // 点線を描画
        const unitLength = dashLength * (1 + 1 / dashRatio);
        const dashPx = unitLength * (dashRatio / (dashRatio + 1));
        const gapPx = unitLength - dashPx;

        ctx.setLineDash([dashPx, gapPx]); // TODO: cache
        ctx.lineWidth = strokeWeight;
        ctx.strokeStyle = strokeColor;
        ctx.lineCap = "round";
        ctx.stroke();
    }
}

function setPath(
    ctx: CanvasRenderingContext2D,
    path: readonly LatLng[],
    projection: google.maps.MapCanvasProjection,
    deviceX: number,
    deviceY: number,
) {
    const start = path[0];
    if (start == null) return;

    ctx.beginPath();

    const { x, y } = projection.fromLatLngToDivPixel(start)!;
    const canvasX = x - deviceX;
    const canvasY = y - deviceY;
    ctx.moveTo(canvasX, canvasY);

    for (let i = 1; i < path.length; i++) {
        const position = path[i]!;
        const { x, y } = projection.fromLatLngToDivPixel(position)!;
        const canvasX = x - deviceX;
        const canvasY = y - deviceY;
        ctx.lineTo(canvasX, canvasY);
    }
    ctx.closePath();
}

function renderDrafts(
    ctx: CanvasRenderingContext2D,
    drafts: DraftViews,
    config: ViewConfig["draftMarker"],
    projection: google.maps.MapCanvasProjection,
    deviceX: number,
    deviceY: number,
) {
    const strokeStyle = config.strokeColor;
    const fillStyle = config.fillColor;
    const radius = config.scale;
    const lineWidth = config.strokeWeight;

    for (const draft of drafts.values()) {
        const position = draft.draft.coordinates[0];
        const pixel = projection.fromLatLngToDivPixel(position)!;

        // Canvas内の相対座標に変換
        const x = pixel.x - deviceX;
        const y = pixel.y - deviceY;

        // 描画処理
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = fillStyle;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, radius + 2, 0, 2 * Math.PI);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeStyle;
        ctx.stroke();
    }
}

function renderCircle(
    ctx: CanvasRenderingContext2D,
    center: LatLng,
    config: CircleConfig,
    projection: google.maps.MapCanvasProjection,
    pixelsPerMeter: number,
    deviceX: number,
    deviceY: number,
) {
    const {
        strokeColor,
        radius: radiusMeters,
        strokeWeight,
        dashRatio,
        dashLength,
    } = config;
    const radius = radiusMeters * pixelsPerMeter;

    const { x, y } = projection.fromLatLngToDivPixel(center)!;

    // Canvas内の相対座標に変換
    const centerX = x - deviceX;
    const centerY = y - deviceY;

    // 点線の計算
    const circumference = 2 * Math.PI * radius;
    const targetUnitLength = dashLength * (1 + 1 / dashRatio);
    const numberOfUnits = Math.max(
        1,
        Math.round(circumference / targetUnitLength),
    );
    const actualUnitLength = circumference / numberOfUnits;
    const dashPx = actualUnitLength * (dashRatio / (dashRatio + 1));
    const gapPx = actualUnitLength - dashPx;

    // 描画
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);

    ctx.setLineDash([dashPx, gapPx]); // TODO: cache
    ctx.lineWidth = strokeWeight;
    ctx.strokeStyle = strokeColor;
    ctx.lineCap = "round";

    ctx.stroke();
}
