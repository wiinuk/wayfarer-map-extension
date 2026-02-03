import { S2, type LatLng, type S2Cell } from "./s2";

function cellVsBounds(cell: S2Cell, bounds: google.maps.LatLngBounds) {
    const cellCorners = cell.getCornerLatLngs();

    // セルの角が Bounds に含まれているか
    for (const cellCorner of cellCorners) {
        if (bounds.contains(cellCorner)) return true;
    }

    return cellVsBoundsRest(cellCorners, bounds);
}

function cellVsBoundsRest(cellCorners: readonly LatLng[], bounds: google.maps.LatLngBounds) {
    // セルの角を含む外接矩形に含まれなければ交差しない
    const cellBounds = new google.maps.LatLngBounds();
    for (const cellCorner of cellCorners) {
        cellBounds.extend(cellCorner);
    }
    if (!bounds.intersects(cellBounds)) return false;

    // Bounds の角がセルに含まれているか
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const boundsCorners = [
        sw,
        ne,
        new google.maps.LatLng(sw.lat(), ne.lng()), // 北西
        new google.maps.LatLng(ne.lat(), sw.lng()), // 南東
    ];
    for (const corner of boundsCorners) {
        if (pointVsPolygon(corner, cellCorners)) return true;
    }

    // 辺同士が交差しているか（十字に重なっている場合）
    const boundsEdges = [
        [boundsCorners[0], boundsCorners[3]], // 南辺
        [boundsCorners[3], boundsCorners[1]], // 東辺
        [boundsCorners[1], boundsCorners[2]], // 北辺
        [boundsCorners[2], boundsCorners[0]], // 西辺
    ];
    const cellEdges = [
        [cellCorners[0], cellCorners[1]],
        [cellCorners[1], cellCorners[2]],
        [cellCorners[2], cellCorners[3]],
        [cellCorners[3], cellCorners[0]],
    ];
    for (const [boundsEdgePoint1, boundsEdgePoint2] of boundsEdges) {
        for (const cellEdge of cellEdges) {
            if (
                segmentVsSegment(
                    boundsEdgePoint1.lat(),
                    boundsEdgePoint1.lng(),
                    boundsEdgePoint2.lat(),
                    boundsEdgePoint2.lng(),
                    cellEdge[0].lat,
                    cellEdge[0].lng,
                    cellEdge[1].lat,
                    cellEdge[1].lng
                )
            ) {
                return true;
            }
        }
    }

    // 交差していない
    return false;
}

function pointVsPolygon(point: google.maps.LatLng, polygon: readonly LatLng[]) {
    let inside = false;
    const x = point.lng();
    const y = point.lat();

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lng,
            yi = polygon[i].lat;
        const xj = polygon[j].lng,
            yj = polygon[j].lat;

        const intersect =
            yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

function segmentVsSegment(p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number, p4x: number, p4y: number) {
    const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
        return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    };

    const d1 = ccw(p3x, p3y, p4x, p4y, p1x, p1y);
    const d2 = ccw(p3x, p3y, p4x, p4y, p2x, p2y);
    const d3 = ccw(p1x, p1y, p2x, p2y, p3x, p3y);
    const d4 = ccw(p1x, p1y, p2x, p2y, p4x, p4y);

    return (
        ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    );
}

function getLatLngPoint(data: google.maps.LatLng | LatLng) {
    return {
        lat: typeof data.lat == "function" ? data.lat() : data.lat,
        lng: typeof data.lng == "function" ? data.lng() : data.lng,
    };
}
export function collectCoveringS2Cells(center: google.maps.LatLng | LatLng, bounds: google.maps.LatLngBounds, level: number) {
    const result: S2Cell[] = [];

    const remainingCells = [
        S2.S2Cell.FromLatLng(getLatLngPoint(center), level),
    ];
    const seenCellIds = new Set();
    for (let cell; (cell = remainingCells.pop());) {
        const cellId = cell.toString();
        if (seenCellIds.has(cellId)) continue;
        seenCellIds.add(cellId);

        if (!cellVsBounds(cell, bounds)) continue;
        result.push(cell);
        remainingCells.push(...cell.getNeighbors());
    }
    return result;
}
