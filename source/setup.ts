import { addS2Overlay } from "./cell-overlay";
import { awaitElement } from "./standard-extensions";

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

async function setupS2Overlay() {
    const gMap = await getGMapObject();

    function grid(level: number, color?: string, zIndex?: number) {
        if (!color) {
            switch (level % 4) {
                case 0:
                    color = "#808080";
                    break;
                case 2:
                    color = "#E0E0E0";
                    break;
                default:
                    color = "#C0C0C0";
            }
        }
        return { level, color, zIndex };
    }
    addS2Overlay(
        gMap,
        grid(4),
        grid(5),
        grid(6),
        grid(7),
        grid(8),
        grid(9),
        grid(10),
        grid(11),
        grid(12),
        grid(13),
        grid(14, "#0000FF", 401),
        grid(15),
        grid(16),
        grid(17, "#FF0000", 400)
    );
}


// マップを検出してS2オーバーレイを適用するメイン処理
async function onPageUpdated() {
    // Google Maps APIがロードされるのを待機してから描画
    if (typeof google === "undefined" || typeof google.maps === "undefined") {
        setTimeout(onPageUpdated, 500);
        return;
    }

    await Promise.all([setupS2Overlay()]);
}

export function setup() {
    // スクリプト開始
    // URL変更を検知して再実行する簡易的な仕組み
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            onPageUpdated();
        }
    }).observe(document, { subtree: true, childList: true });

    onPageUpdated();
}