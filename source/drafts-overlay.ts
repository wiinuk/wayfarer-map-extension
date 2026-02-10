import * as remote from "./remote";
import type { Draft } from "./remote";
import {
    createAsyncCancelScope,
    sleep,
    type Reference,
} from "./standard-extensions";
import { padBounds, parseCoordinates } from "./geometry";
import { createScheduler, type Scheduler } from "./dom-extensions";
import type { LocalConfigAccessor } from "./local-config";
import classNames, { cssText } from "./drafts-overlay.module.css";
import type { LatLng } from "./s2";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
    type TypedEventTarget,
} from "./typed-event-target";
import {
    createCanvasOverlay,
    type DraftCanvasOverlay,
} from "./drafts-canvas-overlay";

export interface DraftWithView {
    readonly draft: Draft;
    readonly mapView: MapView;
}
interface MapView {
    readonly marker: google.maps.Marker;
    readonly label: google.maps.MarkerLabel;
}

export interface CircleConfig {
    /** [m] */
    readonly radius: number;

    /** css color */
    readonly strokeColor: string;
    readonly strokeWeight: number;
    /** [px] */
    readonly dashLength: number;
    /** 点線の、空白を1としたときの点部分の割合 */
    readonly dashRatio: number;
}
export interface PolygonConfig {
    readonly fill: boolean;
    readonly fillColor: string;

    /** css color */
    readonly strokeColor: string;
    readonly strokeWeight: number;
    /** [px] */
    readonly dashLength: number;
    /** 点線の、空白を1としたときの点部分の割合 */
    readonly dashRatio: number;
}
export interface ViewConfig {
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
    readonly selected: {
        readonly tooClose: CircleConfig;
        readonly submissionDistance: CircleConfig;
        readonly cell: Readonly<Record<`${number}`, PolygonConfig>>;
    };
}
interface ViewOptionsCache {
    readonly draftMarkerOptions: google.maps.MarkerOptions;
    readonly draftMarkerLabel: google.maps.MarkerLabel;
}
function createDefaultViewConfig(): ViewConfig {
    const cell: PolygonConfig = {
        strokeColor: "rgba(240, 252, 249, 0.7)",
        strokeWeight: 4,
        dashLength: 30,
        dashRatio: 2,

        fillColor: "",
        fill: false,
    };

    const cell17: PolygonConfig = {
        strokeColor: "",
        strokeWeight: 0,
        dashLength: 30,
        dashRatio: 2,

        fillColor: "rgba(240, 252, 249, 0.4)",
        fill: true,
    };
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
        selected: {
            tooClose: {
                radius: 20,
                strokeColor: "rgb(240, 252, 249)",
                strokeWeight: 2,
                dashLength: 30,
                dashRatio: 3,
            },
            submissionDistance: {
                radius: 10 * 1000,
                strokeColor: "rgb(231, 18, 196)",
                strokeWeight: 5,
                dashLength: 50,
                dashRatio: 3,
            },
            cell: {
                14: cell,
                16: cell,
                17: cell17,
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

export type DraftId = Draft["id"];
export type DraftViews = Map<DraftId, DraftWithView>;
export interface DraftsOverlayEventMap {
    "drafts-updated": readonly Draft[];
    "draft-updated": DraftId;
    "selection-changed": DraftId | null;
}
export interface DraftsOverlay {
    readonly map: google.maps.Map;
    readonly config: ViewConfig;
    readonly cachedOptions: ViewOptionsCache;
    readonly addedMapViews: Set<MapView>;
    readonly drafts: DraftViews;
    readonly selectedDraftId: Reference<DraftId | null>;
    readonly draftsCanvasOverlay: DraftCanvasOverlay;
    readonly asyncRenderDraftsInMapScope: (
        scope: (signal: AbortSignal) => Promise<void>,
    ) => void;
    readonly asyncRouteListUpdateScope: (
        scope: (signal: AbortSignal) => Promise<void>,
    ) => void;
    readonly events: TypedEventTarget<DraftsOverlayEventMap>;
    updateDraftTitle(draft: Draft): void;
    updateDraftCoordinates(draft: Draft): void;
    addDraft(draft: Draft): void;
    deleteDraft(draftId: Draft["id"]): void;
    select(id: string): void;
}
function notifyDraftListUpdated(overlay: DraftsOverlay) {
    overlay.asyncRouteListUpdateScope(async (_signal) => {
        const drafts = [];
        for (const v of overlay.drafts.values()) {
            drafts.push(v.draft);
        }
        overlay.events.dispatchEvent(
            createTypedCustomEvent("drafts-updated", drafts),
        );
    });
}

function getPosition(draft: Draft) {
    return draft.coordinates[0];
}
function includesIn(bounds: google.maps.LatLngBounds, draft: Draft) {
    return bounds.contains(getPosition(draft));
}
function addDraftCore(overlay: DraftsOverlay, draft: Draft) {
    overlay.drafts.set(draft.id, {
        draft,
        mapView: createMapView(overlay, draft),
    });
    notifyDraftListUpdated(overlay);
}

function deleteDraftCore(overlay: DraftsOverlay, draftId: Draft["id"]) {
    const draftWithView = overlay.drafts.get(draftId);
    if (draftWithView) {
        draftWithView.mapView.marker.setMap(null);
        overlay.drafts.delete(draftId);
        if (overlay.selectedDraftId.contents === draftId) {
            overlay.selectedDraftId.contents = null;
            updateSelectedView(overlay);
        }
        notifyDraftListUpdated(overlay);
    }
}

function updateSelectedView(overlay: DraftsOverlay) {
    overlay.draftsCanvasOverlay.draw();
}

function createMapView(overlay: DraftsOverlay, draft: remote.Draft): MapView {
    const label: google.maps.MarkerLabel = {
        ...overlay.cachedOptions.draftMarkerLabel,
        text: draft.name,
    };
    const marker = new google.maps.Marker(
        overlay.cachedOptions.draftMarkerOptions,
    );
    marker.setPosition(getPosition(draft));
    marker.setLabel(label);
    marker.addListener("click", () => {
        overlay.select(draft.id);
    });
    marker.addListener("dragend", () => {
        const newPosition = marker.getPosition();
        if (newPosition == null) return;

        draft.coordinates = [
            { lat: newPosition.lat(), lng: newPosition.lng() },
        ] as [LatLng, ...LatLng[]];
        overlay.updateDraftCoordinates(draft);
        overlay.events.dispatchEvent(
            createTypedCustomEvent("draft-updated", draft.id),
        );
    });
    return {
        label,
        marker,
    };
}

export function isNeedDetail(map: google.maps.Map, config: ViewConfig) {
    return config.minDetailZoom <= (map.getZoom() ?? 0);
}
function updateMapView(
    overlay: DraftsOverlay,
    { mapView, draft }: DraftWithView,
) {
    const needDetail = isNeedDetail(overlay.map, overlay.config);
    const hasDetail = mapView.marker.getMap() != null;
    if (needDetail !== hasDetail) {
        if (needDetail) {
            mapView.marker.setMap(overlay.map);
        } else {
            mapView.marker.setLabel(null);
        }
    }
    mapView.marker.setDraggable(overlay.selectedDraftId.contents === draft.id);
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
    const needDetail = isNeedDetail(overlay.map, overlay.config);

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

export function createDraftsOverlay(
    map: google.maps.Map,
    asyncErrorHandler: (reason: unknown) => void,
): DraftsOverlay {
    const config = createDefaultViewConfig();
    const drafts: DraftViews = new Map();
    const selectedDraftId = { contents: null };
    const draftsCanvasOverlay = createCanvasOverlay(
        drafts,
        config,
        selectedDraftId,
    );
    return {
        events: createTypedEventTarget(),
        config,
        cachedOptions: createOptionsCache(config),
        map,
        drafts,
        selectedDraftId,
        draftsCanvasOverlay,
        addedMapViews: new Set(),
        asyncRouteListUpdateScope: createAsyncCancelScope(asyncErrorHandler),
        asyncRenderDraftsInMapScope: createAsyncCancelScope(asyncErrorHandler),
        updateDraftTitle(draft: Draft) {
            const draftWithView = this.drafts.get(draft.id);
            if (draftWithView) {
                draftWithView.draft.name = draft.name;
                draftWithView.mapView.marker.setLabel({
                    ...draftWithView.mapView.label,
                    text: draft.name,
                });
                notifyMapRangeChanged(this);
            }
        },
        updateDraftCoordinates(this: DraftsOverlay, draft: Draft) {
            const draftWithView = this.drafts.get(draft.id);
            if (draftWithView) {
                draftWithView.draft.coordinates = draft.coordinates;
                draftWithView.mapView.marker.setPosition(getPosition(draft));
                if (this.selectedDraftId.contents === draft.id) {
                    updateSelectedView(this);
                }
                notifyMapRangeChanged(this);
            }
        },
        addDraft(this: DraftsOverlay, draft: Draft) {
            addDraftCore(this, draft);
            notifyMapRangeChanged(this);
        },
        deleteDraft(this: DraftsOverlay, draftId: Draft["id"]) {
            deleteDraftCore(this, draftId);
            notifyMapRangeChanged(this);
        },
        select(draftId: Draft["id"]) {
            const draft = this.drafts.get(draftId)?.draft;
            if (draft == null) return;

            this.selectedDraftId.contents = draft.id;
            updateSelectedView(this);

            this.events.dispatchEvent(
                createTypedCustomEvent("selection-changed", draft.id),
            );
            notifyMapRangeChanged(this);
        },
    };
}
export async function setupDraftsOverlay(
    overlay: DraftsOverlay,
    local: LocalConfigAccessor,
    scheduler: Scheduler,
) {
    const style = document.createElement("style");
    style.textContent = cssText;
    document.body.append(style);

    overlay.draftsCanvasOverlay.setMap(overlay.map);

    const { userId, apiRoot } = local.getConfig();
    if (userId && apiRoot) {
        const { routes } = await remote.getDrafts(
            {
                "user-id": userId,
            },
            { rootUrl: apiRoot },
        );
        for (const route of routes) {
            await scheduler.yield();
            overlay.addDraft({
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
