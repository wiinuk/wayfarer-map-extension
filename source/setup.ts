import { addNavigateListener } from "./dom-extensions";
import { awaitElement } from "./standard-extensions";

function handleAsyncError(reason: unknown) {
    console.error("An error occurred during asynchronous processing:", reason);
}

async function getGMapObject(): Promise<google.maps.Map> {
    return await awaitElement(() => {
        try {
            // 実行時エラーは catch で無視する
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const e: any = document.querySelector("app-wf-base-map");
            return e.__ngContext__[27];
        } catch {
            return null;
        }
    });
}

async function onEnterMapPage() {
    await awaitElement(() => document.querySelector("#wfmapmods-side-panel"));
    const gmap = await getGMapObject();
    console.log("Google Map object:", gmap);
}
function onLeaveMapPage() {
    // TODO: クリーンアップ処理
}

export function setup() {
    addNavigateListener(() => {
        if (window.location.pathname.startsWith("/new/mapview")) {
            onEnterMapPage().catch(handleAsyncError);
        } else {
            onLeaveMapPage();
        }
    });
}