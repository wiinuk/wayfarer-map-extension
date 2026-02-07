import * as remote from "./remote";
import type { Draft } from "./remote";
import { createAsyncCancelScope, sleep } from "./standard-extensions";
import { padBounds, parseCoordinates } from "./geometry";
import { createScheduler, type Scheduler } from "./dom-extensions";
import type { LocalConfigAccessor } from "./local-config";
import classNames, { cssText } from "./drafts-overlay.module.css";
import type { LatLng } from "./s2";

interface DraftWithView {
    readonly draft: Draft;
    readonly listView: HTMLElement;
    readonly mapView: MapView;
}
interface MapView {
    readonly marker: google.maps.Marker;
    readonly label: google.maps.MarkerLabel;
}

interface ViewConfig {
    readonly minDetailZoom: number;
    readonly baseZIndex: number;
    readonly draftMarker: {
        readonly scale: number;
        readonly fillColor: string;
        readonly strokeColor: string;
        readonly strokeWeight: number;
        readonly label: {
            readonly fillColor: string;
            readonly fontSize: string;
            readonly className: string;
        };
    };
}
interface ViewOptionsCache {
    readonly draftMarkerOptions: google.maps.MarkerOptions;
    readonly draftMarkerLabel: google.maps.MarkerLabel;
}
function createDefaultViewConfig(): ViewConfig {
    return {
        minDetailZoom: 16,
        baseZIndex: 3100,
        draftMarker: {
            scale: 9,
            fillColor: "#00ffb380",
            strokeColor: "#ffffff80",
            strokeWeight: 2,
            label: {
                fillColor: "#FFFFBB",
                fontSize: "11px",
                className: classNames.label,
            },
        },
    };
}
function createOptionsCache(config: ViewConfig): ViewOptionsCache {
    return {
        draftMarkerOptions: {
            zIndex: config.baseZIndex,
            icon: {
                ...config.draftMarker,

                labelOrigin: new google.maps.Point(0, 2),
                path: 0,
                fillOpacity: 1,
                strokeOpacity: 1,
            },
        },
        draftMarkerLabel: {
            ...config.draftMarker.label,
            text: "",
            color: config.draftMarker.label.fillColor,
        },
    };
}

type DraftId = Draft["id"];
type DraftViews = Map<DraftId, DraftWithView>;
export interface DraftsOverlay {
    readonly map: google.maps.Map;
    readonly config: ViewConfig;
    readonly cachedOptions: ViewOptionsCache;
    readonly addedMapViews: Set<MapView>;
    readonly drafts: DraftViews;
    readonly draftsCanvasOverlay: DraftCanvasOverlay;
    readonly asyncRenderDraftsInMapScope: (
        scope: (signal: AbortSignal) => Promise<void>,
    ) => void;
    readonly asyncRouteListUpdateScope: (
        scope: (signal: AbortSignal) => Promise<void>,
    ) => void;
    updateList?: (newDrafts: Draft[]) => void;
}
function notifyDraftListUpdated(overlay: DraftsOverlay) {
    overlay.asyncRouteListUpdateScope(async (_signal) => {
        if (overlay.updateList) {
            const currentDrafts = Array.from(overlay.drafts.values()).map(
                (view) => view.draft,
            );
            overlay.updateList(currentDrafts);
        }
    });
}

function getPosition(draft: Draft) {
    return draft.coordinates[0]!;
}
function includesIn(bounds: google.maps.LatLngBounds, draft: Draft) {
    return bounds.contains(getPosition(draft));
}
function addDraft(overlay: DraftsOverlay, draft: Draft) {
    overlay.drafts.set(draft.id, {
        draft,
        listView: document.createElement("li"),
        mapView: createMapView(overlay, draft),
    });
    notifyDraftListUpdated(overlay);
}
function createMapView(
    { cachedOptions }: DraftsOverlay,
    draft: remote.Draft,
): MapView {
    const label: google.maps.MarkerLabel = {
        ...cachedOptions.draftMarkerLabel,
        text: draft.name,
    };
    const marker = new google.maps.Marker(cachedOptions.draftMarkerOptions);
    marker.setPosition(getPosition(draft));
    marker.setLabel(label);
    return {
        label,
        marker,
    };
}

function isNeedDetail({ map, config }: DraftsOverlay) {
    return config.minDetailZoom <= (map.getZoom() ?? 0);
}
function updateMapView(overlay: DraftsOverlay, { mapView }: DraftWithView) {
    const needDetail = isNeedDetail(overlay);
    const hasDetail = mapView.marker.getMap() != null;
    if (needDetail !== hasDetail) {
        if (needDetail) {
            mapView.marker.setMap(overlay.map);
        } else {
            mapView.marker.setLabel(null);
        }
    }
}
function deleteDetailView(overlay: DraftsOverlay, view: MapView) {
    overlay.addedMapViews.delete(view);
    view.marker.setMap(null);
}

async function renderDraftsInMap(overlay: DraftsOverlay, scheduler: Scheduler) {
    const { drafts, map } = overlay;
    const bounds = map.getBounds();
    if (bounds == null) return;

    // 詳細表示かどうか
    const needDetail = isNeedDetail(overlay);
    const hasDetail = overlay.draftsCanvasOverlay.getMap() == null;
    if (needDetail !== hasDetail) {
        overlay.draftsCanvasOverlay.setMap(needDetail ? null : map);
    }
    // 簡易表示の場合
    if (!needDetail) {
        // 詳細表示を削除
        for (const oldView of overlay.addedMapViews) {
            deleteDetailView(overlay, oldView);
        }
        return;
    }

    // 範囲内のスポットを計算する
    const viewToDrafts = new Map<MapView, DraftWithView>();
    const visibleBounds = padBounds(bounds, 0.2); // 範囲外のスポットがはみ出してしまい見える場合があるのでマップの可視範囲を広めに取る
    for (const view of drafts.values()) {
        if (includesIn(visibleBounds, view.draft)) {
            viewToDrafts.set(view.mapView, view);
        }
    }

    // 範囲内のスポットの表示を更新する
    for (const view of viewToDrafts.values()) {
        await scheduler.yield();
        updateMapView(overlay, view);
    }

    // 現在追加されているレイヤーが範囲外なら削除する
    for (const oldView of overlay.addedMapViews) {
        await scheduler.yield();

        if (viewToDrafts.has(oldView)) {
            viewToDrafts.delete(oldView);
        } else {
            deleteDetailView(overlay, oldView);
        }
    }

    // 範囲内レイヤーのうち追加されていないものを追加する
    for (const view of viewToDrafts.keys()) {
        await scheduler.yield();
        view.marker.setMap(overlay.map);
        overlay.addedMapViews.add(view);
    }
}
function notifyMapRangeChanged(overlay: DraftsOverlay) {
    overlay.asyncRenderDraftsInMapScope(async (signal) => {
        await sleep(100, { signal });
        const scheduler = createScheduler(signal);
        return await renderDraftsInMap(overlay, scheduler);
    });
}

type DraftCanvasOverlay = ReturnType<typeof createCanvasOverlay>;
function createCanvasOverlay(drafts: DraftViews, config: ViewConfig) {
    class CanvasOverlay extends google.maps.OverlayView {
        private _canvas: HTMLCanvasElement;
        constructor(
            private _drafts: DraftViews,
            private _config: ViewConfig,
        ) {
            super();
            this._canvas = document.createElement("canvas");
            this._canvas.style.position = "absolute";
        }

        // Overlay が地図に追加された時に呼ばれる
        override onAdd() {
            const panes = this.getPanes()!;
            panes.overlayLayer.appendChild(this._canvas);
        }
        override onRemove() {
            if (this._canvas.parentNode) {
                this._canvas.parentNode.removeChild(this._canvas);
            }
        }

        // 地図が動いたりズームしたりする度に呼ばれる
        override draw() {
            const projection = this.getProjection();
            if (!projection) return;

            const map = this.getMap();
            if (!(map instanceof google.maps.Map)) return;

            const bounds = map.getBounds()!;
            const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest())!;
            const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast())!;

            // Canvas のサイズと位置を現在の表示範囲に合わせる
            const canvas = this._canvas;
            canvas.style.left = sw.x + "px";
            canvas.style.top = ne.y + "px";
            canvas.width = ne.x - sw.x;
            canvas.height = sw.y - ne.y;

            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // 各POIを描画
            const strokeStyle = this._config.draftMarker.strokeColor;
            const fillStyle = this._config.draftMarker.fillColor;
            const radius = this._config.draftMarker.scale;
            const lineWidth = this._config.draftMarker.strokeWeight;

            for (const draft of this._drafts.values()) {
                const position = draft.draft.coordinates[0];
                const pixel = projection.fromLatLngToDivPixel(position)!;

                // Canvas内の相対座標に変換
                const x = pixel.x - sw.x;
                const y = pixel.y - ne.y;

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
    }
    return new CanvasOverlay(drafts, config);
}

export function createDraftsOverlay(
    map: google.maps.Map,
    asyncErrorHandler: (reason: unknown) => void,
): DraftsOverlay {
    const config = createDefaultViewConfig();
    const drafts: DraftViews = new Map();
    const draftsCanvasOverlay = createCanvasOverlay(drafts, config);
    return {
        config,
        cachedOptions: createOptionsCache(config),
        map,
        drafts,
        draftsCanvasOverlay,
        addedMapViews: new Set(),
        asyncRouteListUpdateScope: createAsyncCancelScope(asyncErrorHandler),
        asyncRenderDraftsInMapScope: createAsyncCancelScope(asyncErrorHandler),
    };
}
export async function setupDraftsOverlay(
    overlay: DraftsOverlay,
    local: LocalConfigAccessor,
) {
    const style = document.createElement("style");
    style.innerText = cssText;
    document.body.append(style);

    const { userId, apiRoot } = local.getConfig();
    if (userId && apiRoot) {
        const { routes } = await remote.getDrafts(
            {
                "user-id": userId,
            },
            { rootUrl: apiRoot },
        );
        for (const route of routes) {
            addDraft(overlay, {
                ...route,
                coordinates: parseCoordinates(route.coordinates) as [
                    LatLng,
                    ...LatLng[],
                ],
                id: route.routeId,
                name: route.routeName,
            });
        }
    }
    overlay.map.addListener("idle", () => notifyMapRangeChanged(overlay));
    notifyMapRangeChanged(overlay);
}
