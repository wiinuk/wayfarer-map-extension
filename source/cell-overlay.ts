import { S2, type S2Cell } from "./s2";
import { collectCoveringS2Cells } from "./s2-hittest";
import { raise } from "./standard-extensions";

interface GridOptions {
    level: number;
    color: string;
    zIndex?: number;
}

export function addS2Overlay(map: google.maps.Map, ...gridOptions: GridOptions[]) {
    const overlay = new S2Overlay();

    function drawGrids() {
        for (const { level, color, zIndex } of gridOptions) {
            overlay.drawCellGrid(map, level, color, zIndex);
        }
    }
    drawGrids();
    map.addListener("idle", () => {
        overlay.clearGrid();
        drawGrids();
    });
}

class S2Overlay {
    polyLines: google.maps.Polyline[] = [];

    check_map_bounds_ready(map: google.maps.Map) {
        if (
            !map ||
            map.getBounds === undefined ||
            map.getBounds() === undefined
        ) {
            return false;
        } else {
            return true;
        }
    }

    until(conditionFunction: (map: google.maps.Map) => boolean, map: google.maps.Map): Promise<void> {
        const poll = (resolve: () => void) => {
            if (conditionFunction(map)) resolve();
            else setTimeout(() => poll(resolve), 400);
        };
        return new Promise(poll);
    }

    clearGrid() {
        this.polyLines.forEach((line) => {
            line.setMap(null);
        });
        this.polyLines = []; // クリア
    }

    async drawCellGrid(
        map: google.maps.Map,
        gridLevel: number,
        color: string | null,
        zIndex = (S2.MAX_LEVEL - gridLevel + 1) * 10
    ) {
        await this.until(this.check_map_bounds_ready, map);

        // ズームレベルに応じた描画制御
        if (gridLevel < 2 || gridLevel >= (map.getZoom() ?? 0) + 2) return;

        const center = map.getCenter() ?? raise`map center undefined`;
        const bounds = map.getBounds() ?? raise`map bounds undefined`;
        const cellsToDraw = collectCoveringS2Cells(center, bounds, gridLevel);
        for (const cell of cellsToDraw) {
            this.drawCell(map, cell, color, zIndex);
        }
    }

    drawCell(map: google.maps.Map, cell: S2Cell, color: string | null, zIndex: number) {
        const cellCorners = cell.getCornerLatLngs();
        cellCorners[4] = cellCorners[0]; //Loop it

        const polyline = new google.maps.Polyline({
            path: cellCorners,
            geodesic: true,
            // fillColor: "grey",
            // fillOpacity: 0.0,
            strokeColor: color,
            strokeOpacity: 1,
            strokeWeight: 1,
            map: map,
            clickable: false, // クリック判定を無効化して操作性を維持
            zIndex,
        });
        this.polyLines.push(polyline);
    }
}
