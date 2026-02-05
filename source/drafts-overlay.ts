import * as remote from "./remote";
import type { Draft } from "./remote";
import { createAsyncCancelScope } from "./standard-extensions";
import { padBounds, parseCoordinates } from "./geometry";
import { createScheduler, type Scheduler } from "./dom-extensions";
import type { LocalConfigAccessor } from "./local-config";
import classNames, { cssText } from "./drafts-overlay.module.css";

interface DraftWithView {
    readonly draft: Draft;
    readonly listView: HTMLElement;
    readonly mapView: google.maps.Marker;
    readonly mapViewLabel: google.maps.MarkerLabel;
}
type MapView = DraftWithView["mapView"];

interface ViewOptions {
    readonly baseZIndex: number;
    readonly draftMarker: {
        readonly options: google.maps.MarkerOptions;
        readonly label: google.maps.MarkerLabel;
        readonly className: string;
    };
}
function createDefaultViewOptions(): ViewOptions {
    const baseZIndex = 3100;
    let draftMarker: ViewOptions["draftMarker"];
    {
        const className = classNames.label;
        draftMarker = {
            options: Object.freeze({
                zIndex: baseZIndex,
                icon: {
                    labelOrigin: new google.maps.Point(0, 2),
                    path: 0,
                    fillColor: "#00ffb3",
                    fillOpacity: 0.5,
                    scale: 9,
                    strokeColor: "#ffffff",
                    strokeOpacity: 0.5,
                    strokeWeight: 2,
                },
            } satisfies google.maps.MarkerOptions),
            label: Object.freeze({
                text: "",
                color: "#FFFFBB",
                fontSize: "11px",
                className,
            } satisfies google.maps.MarkerLabel),
            className,
        };
    }
    return {
        baseZIndex,
        draftMarker,
    };
}

type DraftId = Draft["id"];
export interface DraftsOverlay {
    readonly map: google.maps.Map;
    readonly options: ViewOptions;
    readonly addedMapViews: Set<MapView>;
    readonly drafts: Map<DraftId, DraftWithView>;
    readonly asyncRenderDraftsInMapScope: (
        scope: (signal: AbortSignal) => Promise<void>,
    ) => void;
    readonly asyncRouteListUpdateScope: (
        scope: (signal: AbortSignal) => Promise<void>,
    ) => void;
}
function notifyDraftListUpdated(overlay: DraftsOverlay) {
    // overlay.asyncRouteListUpdateScope((signal) => {
    //     return updateRouteListElementAsync(overlay, scheduler, signal);
    // });
}

function getPosition(draft: Draft) {
    return draft.coordinates[0]!;
}
function includesIn(bounds: google.maps.LatLngBounds, draft: Draft) {
    return bounds.contains(getPosition(draft));
}
function addDraft(overlay: DraftsOverlay, draft: Draft) {
    const label: google.maps.MarkerLabel = {
        ...overlay.options.draftMarker.label,
        text: draft.name,
    };
    const marker = new google.maps.Marker(overlay.options.draftMarker);
    marker.setPosition(getPosition(draft));
    marker.setLabel(label);
    overlay.drafts.set(draft.id, {
        draft,
        listView: document.createElement("li"),
        mapView: marker,
        mapViewLabel: label,
    });
    notifyDraftListUpdated(overlay);
}
function updateMapView(overlay: DraftsOverlay, view: DraftWithView) {
    const needLabel = 16 <= (overlay.map.getZoom() ?? 0);
    const hasLabel = view.mapView.getLabel() != null;
    if (needLabel !== hasLabel) {
        view.mapView.setLabel(needLabel ? view.mapViewLabel : null);
    }
    // マップ内のViewを更新
    // ズームに応じた表示内容の変更など
}
async function renderDraftsInMap(overlay: DraftsOverlay, scheduler: Scheduler) {
    const { drafts, map } = overlay;
    const bounds = map.getBounds();
    if (bounds == null) return;

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
            overlay.addedMapViews.delete(oldView);
            oldView.setMap(null);
        }
    }

    // 範囲内レイヤーのうち追加されていないものを追加する
    for (const view of viewToDrafts.keys()) {
        await scheduler.yield();
        view.setMap(overlay.map);
        overlay.addedMapViews.add(view);
    }
}
function notifyMapRangeChanged(overlay: DraftsOverlay) {
    overlay.asyncRenderDraftsInMapScope((signal) => {
        const scheduler = createScheduler(signal);
        return renderDraftsInMap(overlay, scheduler);
    });
}

export function createDraftsOverlay(
    map: google.maps.Map,
    asyncErrorHandler: (reason: unknown) => void,
): DraftsOverlay {
    return {
        options: createDefaultViewOptions(),
        map,
        drafts: new Map(),
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
        const { routes } = await remote.getRoutes(
            {
                "user-id": userId,
            },
            { rootUrl: apiRoot },
        );
        for (const route of routes) {
            addDraft(overlay, {
                ...route,
                coordinates: parseCoordinates(route.coordinates),
                id: route.routeId,
                name: route.routeName,
            });
        }
    }
    overlay.map.addListener("idle", () => notifyMapRangeChanged(overlay));
    notifyMapRangeChanged(overlay);
}
