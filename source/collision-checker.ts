interface Box {
    readonly centerX: number;
    readonly centerY: number;
    readonly width: number;
    readonly height: number;
    readonly key: unknown;
}

/**
 * @param cellSize 判定対象Boxの平均的なサイズの2〜3倍が目安
 */
export function createCollisionChecker(cellSize = 128) {
    const buckets = new Map<number, Box[]>();

    function getBucketKey(gx: number, gy: number) {
        return (gx << 16) | (gy & 0xffff);
    }

    function getGridKeys(box: Box, result: number[]) {
        const minX = box.centerX - box.width / 2;
        const maxX = box.centerX + box.width / 2;
        const minY = box.centerY - box.height / 2;
        const maxY = box.centerY + box.height / 2;

        const startX = Math.floor(minX / cellSize);
        const endX = Math.floor(maxX / cellSize);
        const startY = Math.floor(minY / cellSize);
        const endY = Math.floor(maxY / cellSize);

        for (let gx = startX; gx <= endX; gx++) {
            for (let gy = startY; gy <= endY; gy++) {
                result.push(getBucketKey(gx, gy));
            }
        }
    }

    const getGridsResult: number[] = [];
    function addBox(box: Box) {
        getGridKeys(box, getGridsResult);
        try {
            for (const key of getGridsResult) {
                let list = buckets.get(key);
                if (!list) {
                    list = [];
                    buckets.set(key, list);
                }
                list.push(box);
            }
        } finally {
            getGridsResult.length = 0;
        }
    }

    const candidatesCache = new Set<Box>();
    function check(box: Box): boolean {
        getGridKeys(box, getGridsResult);
        try {
            for (const key of getGridsResult) {
                const list = buckets.get(key);
                if (list) {
                    for (const other of list) {
                        candidatesCache.add(other);
                    }
                }
            }
            for (const other of candidatesCache) {
                if (box.key === other.key) continue;

                const dx = Math.abs(box.centerX - other.centerX);
                const combinedHalfWidth = (box.width + other.width) / 2;
                if (dx >= combinedHalfWidth) continue;

                const dy = Math.abs(box.centerY - other.centerY);
                const combinedHalfHeight = (box.height + other.height) / 2;
                if (dy >= combinedHalfHeight) continue;

                return true;
            }
        } finally {
            candidatesCache.clear();
            getGridsResult.length = 0;
        }

        return false;
    }
    return {
        addBox,
        check,
    };
}
