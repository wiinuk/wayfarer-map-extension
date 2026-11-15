import { distance, latLngToWorldPoint, type Point } from "../geometry";
import type { Viewport } from "./canvas-renderer";

const EARTH_RADIUS_METERS = 6_371_000;

export interface RangeDisplayCircle {
    readonly id: string;
    readonly center: {
        readonly lat: number;
        readonly lng: number;
    };
    readonly radius: number;
}

export type RangeDisplayExpression =
    | { readonly type: "circle"; readonly id: string }
    | {
          readonly type: "and" | "or";
          readonly left: RangeDisplayExpression;
          readonly right: RangeDisplayExpression;
      }
    | {
          readonly type: "not";
          readonly expression: RangeDisplayExpression;
      };

export interface RangeDisplayCandidate {
    readonly expression?: RangeDisplayExpression;
    readonly circles: readonly RangeDisplayCircle[];
    readonly constraintOnly?: boolean;
}

export type RangeDisplayContribution = "contributing" | "non-contributing";

export interface RangeDisplayPlan {
    readonly expression: RangeDisplayExpression | boolean | null;
    readonly circles: readonly (RangeDisplayCircle & {
        readonly contribution: RangeDisplayContribution;
    })[];
}

type SimplifiedExpression = RangeDisplayExpression | boolean;
interface SimplifyResult {
    readonly expression: SimplifiedExpression;
    readonly contributingIds: ReadonlySet<string>;
}

function isCircle(
    expression: RangeDisplayExpression,
): expression is Extract<RangeDisplayExpression, { type: "circle" }> {
    return expression.type === "circle";
}

function circleAreaRelation(
    first: RangeDisplayCircle,
    second: RangeDisplayCircle,
): "same" | "disjoint" | "first-contains" | "second-contains" | "overlap" {
    if (
        first.center.lat === second.center.lat &&
        first.center.lng === second.center.lng &&
        first.radius === second.radius
    ) {
        return "same";
    }

    const firstRadius = Math.max(
        0,
        Math.min(first.radius, Math.PI * EARTH_RADIUS_METERS),
    );
    const secondRadius = Math.max(
        0,
        Math.min(second.radius, Math.PI * EARTH_RADIUS_METERS),
    );
    const centerDistance = distance(first.center, second.center);

    if (centerDistance > firstRadius + secondRadius) return "disjoint";
    if (centerDistance + firstRadius <= secondRadius) return "second-contains";
    if (centerDistance + secondRadius <= firstRadius) return "first-contains";
    return "overlap";
}

function simplify(
    expression: RangeDisplayExpression,
    circles: ReadonlyMap<string, RangeDisplayCircle>,
): SimplifyResult {
    if (isCircle(expression)) {
        const circle = circles.get(expression.id);
        if (
            !circle ||
            Number.isNaN(circle.radius) ||
            circle.radius < 0 ||
            !Number.isFinite(circle.center.lat) ||
            !Number.isFinite(circle.center.lng)
        ) {
            return { expression: false, contributingIds: new Set() };
        }
        if (circle.radius >= Math.PI * EARTH_RADIUS_METERS) {
            return { expression: true, contributingIds: new Set() };
        }
        return {
            expression,
            contributingIds: new Set([expression.id]),
        };
    }

    if (expression.type === "not") {
        const inner = simplify(expression.expression, circles);
        if (typeof inner.expression === "boolean") {
            return {
                expression: !inner.expression,
                contributingIds: new Set(),
            };
        }
        if (inner.expression.type === "not") {
            return {
                expression: inner.expression.expression,
                contributingIds: inner.contributingIds,
            };
        }
        return {
            expression: { type: "not", expression: inner.expression },
            contributingIds: inner.contributingIds,
        };
    }

    const left = simplify(expression.left, circles);
    const right = simplify(expression.right, circles);
    const leftExpression = left.expression;
    const rightExpression = right.expression;
    const contributingIds = new Set([
        ...left.contributingIds,
        ...right.contributingIds,
    ]);
    if (expression.type === "and") {
        if (leftExpression === false) return left;
        if (rightExpression === false) return right;
        if (leftExpression === true) return right;
        if (rightExpression === true) return left;
    } else {
        if (leftExpression === true) return left;
        if (rightExpression === true) return right;
        if (leftExpression === false) return right;
        if (rightExpression === false) return left;
    }

    if (
        typeof leftExpression === "boolean" ||
        typeof rightExpression === "boolean"
    ) {
        throw new Error("Unreduced boolean in range display expression.");
    }

    const isComplement = (
        first: RangeDisplayExpression,
        second: RangeDisplayExpression,
    ) =>
        (isCircle(first) &&
            second.type === "not" &&
            isCircle(second.expression) &&
            first.id === second.expression.id) ||
        (isCircle(second) &&
            first.type === "not" &&
            isCircle(first.expression) &&
            second.id === first.expression.id);
    if (isComplement(leftExpression, rightExpression)) {
        return {
            expression: expression.type === "or",
            contributingIds: new Set(),
        };
    }

    if (isCircle(leftExpression) && isCircle(rightExpression)) {
        const leftCircle = circles.get(leftExpression.id)!;
        const rightCircle = circles.get(rightExpression.id)!;
        const relation = circleAreaRelation(leftCircle, rightCircle);
        if (relation === "same") {
            return {
                expression: leftExpression,
                contributingIds: new Set(),
            };
        }
        if (expression.type === "and") {
            if (relation === "disjoint") {
                return { expression: false, contributingIds };
            }
            if (relation === "first-contains") return right;
            if (relation === "second-contains") return left;
        } else {
            if (relation === "disjoint") {
                return {
                    expression: {
                        type: "or",
                        left: leftExpression,
                        right: rightExpression,
                    },
                    contributingIds,
                };
            }
            if (relation === "first-contains") return left;
            if (relation === "second-contains") return right;
        }
    }

    return {
        expression: {
            type: expression.type,
            left: leftExpression,
            right: rightExpression,
        },
        contributingIds,
    };
}

export function createRangeDisplayPlan(
    candidate: RangeDisplayCandidate | undefined,
): RangeDisplayPlan {
    if (candidate == null) return { expression: null, circles: [] };

    const circleMap = new Map(
        candidate.circles.map((circle) => [circle.id, circle]),
    );
    const simplified = candidate.expression
        ? simplify(candidate.expression, circleMap)
        : { expression: false, contributingIds: new Set<string>() };

    return {
        expression: candidate.expression ? simplified.expression : null,
        circles: candidate.circles.map((circle) => ({
            ...circle,
            contribution: simplified.contributingIds.has(circle.id)
                ? "contributing"
                : "non-contributing",
        })),
    };
}

export interface RangeCanvas {
    width: number;
    height: number;
    getContext(
        contextId: "2d",
        options?: CanvasRenderingContext2DSettings,
    ): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

export interface RangeCanvasPool {
    acquire(width: number, height: number): RangeCanvas;
    release(canvas: RangeCanvas): void;
}

export function createRangeCanvasPool(
    createCanvas: () => RangeCanvas,
    maxPoolPixels = 8_000_000,
): RangeCanvasPool {
    const available: RangeCanvas[] = [];

    return {
        acquire(width, height) {
            const index = available.findIndex(
                (canvas) => canvas.width === width && canvas.height === height,
            );
            const canvas =
                index < 0 ? createCanvas() : available.splice(index, 1)[0]!;
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            return canvas;
        },
        release(canvas) {
            const pixels = canvas.width * canvas.height;
            const pooledPixels = available.reduce(
                (total, item) => total + item.width * item.height,
                0,
            );
            if (
                pixels > maxPoolPixels ||
                pooledPixels + pixels > maxPoolPixels
            ) {
                return;
            }
            available.push(canvas);
        },
    };
}

function createCirclePath(
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    circle: RangeDisplayCircle,
    viewport: Viewport,
    scale: number,
) {
    const radius = Math.max(
        0,
        Math.min(circle.radius, Math.PI * EARTH_RADIUS_METERS),
    );
    const sampleCount = Math.min(
        1024,
        Math.max(
            180,
            Math.ceil((radius * 256 * scale) / (EARTH_RADIUS_METERS * 12)),
        ),
    );
    const angularDistance = radius / EARTH_RADIUS_METERS;
    const latitude = (circle.center.lat * Math.PI) / 180;
    const longitude = (circle.center.lng * Math.PI) / 180;
    let previousWorldX: number | undefined;

    context.beginPath();
    for (let index = 0; index <= sampleCount; index++) {
        const bearing = (2 * Math.PI * index) / sampleCount;
        const targetLatitude = Math.asin(
            Math.sin(latitude) * Math.cos(angularDistance) +
                Math.cos(latitude) *
                    Math.sin(angularDistance) *
                    Math.cos(bearing),
        );
        const targetLongitude =
            longitude +
            Math.atan2(
                Math.sin(bearing) *
                    Math.sin(angularDistance) *
                    Math.cos(latitude),
                Math.cos(angularDistance) -
                    Math.sin(latitude) * Math.sin(targetLatitude),
            );
        const point: Point = { x: 0, y: 0 };
        latLngToWorldPoint(
            (targetLatitude * 180) / Math.PI,
            (targetLongitude * 180) / Math.PI,
            point,
        );

        let worldX = point.x;
        if (previousWorldX !== undefined) {
            worldX += Math.round(previousWorldX - worldX);
        } else {
            const viewportWorldWidth = viewport.width / 2 ** viewport.zoom;
            const viewportCenter = viewport.nwWorld.x + viewportWorldWidth / 2;
            worldX += Math.round(viewportCenter - worldX);
        }
        previousWorldX = worldX;
        const x = (worldX - viewport.nwWorld.x) * scale;
        const y = (point.y - viewport.nwWorld.y) * scale;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    context.closePath();
}

function evaluateMask(
    expression: RangeDisplayExpression,
    circles: ReadonlyMap<string, RangeDisplayCircle>,
    pool: RangeCanvasPool,
    width: number,
    height: number,
    viewport: Viewport,
    scale: number,
): RangeCanvas {
    const stack: RangeCanvas[] = [];
    const operations: (
        | { readonly type: "visit"; readonly node: RangeDisplayExpression }
        | {
              readonly type: "combine";
              readonly operator: "and" | "or";
          }
        | { readonly type: "negate" }
    )[] = [{ type: "visit", node: expression }];

    while (operations.length > 0) {
        const operation = operations.pop()!;
        if (operation.type === "visit") {
            const node = operation.node;
            if (node.type === "circle") {
                const surface = pool.acquire(width, height);
                const context = surface.getContext("2d");
                if (!context)
                    throw new Error("2D canvas context is unavailable.");
                context.clearRect(0, 0, width, height);
                const circle = circles.get(node.id);
                if (!circle)
                    throw new Error(`Missing range circle: ${node.id}`);
                if (circle.radius >= Math.PI * EARTH_RADIUS_METERS) {
                    context.fillStyle = "#fff";
                    context.fillRect(0, 0, width, height);
                } else if (circle.radius > 0) {
                    createCirclePath(context, circle, viewport, scale);
                    context.fillStyle = "#fff";
                    context.fill();
                }
                stack.push(surface);
            } else if (node.type === "not") {
                operations.push({ type: "negate" });
                operations.push({ type: "visit", node: node.expression });
            } else {
                operations.push({ type: "combine", operator: node.type });
                operations.push({ type: "visit", node: node.right });
                operations.push({ type: "visit", node: node.left });
            }
            continue;
        }

        if (operation.type === "negate") {
            const inner = stack.pop()!;
            const result = pool.acquire(width, height);
            const context = result.getContext("2d");
            if (!context) throw new Error("2D canvas context is unavailable.");
            context.fillStyle = "#fff";
            context.fillRect(0, 0, width, height);
            context.globalCompositeOperation = "destination-out";
            context.drawImage(inner as CanvasImageSource, 0, 0);
            context.globalCompositeOperation = "source-over";
            pool.release(inner);
            stack.push(result);
            continue;
        }

        const right = stack.pop()!;
        const left = stack.pop()!;
        const context = left.getContext("2d");
        if (!context) throw new Error("2D canvas context is unavailable.");
        context.globalCompositeOperation =
            operation.operator === "and" ? "destination-in" : "source-over";
        context.drawImage(right as CanvasImageSource, 0, 0);
        context.globalCompositeOperation = "source-over";
        pool.release(right);
        stack.push(left);
    }
    if (stack.length !== 1)
        throw new Error("Invalid range display expression.");
    return stack[0]!;
}

export function renderRangeDisplay(
    canvas: RangeCanvas,
    pool: RangeCanvasPool,
    plan: RangeDisplayPlan,
    viewport: Viewport,
): void {
    const dpr = Math.max(1, Math.min(viewport.devicePixelRatio, 2));
    const maxDimension = 4096;
    const requestedScale = dpr;
    const viewportPixels = Math.max(viewport.width * viewport.height, 1);
    const backingScale = Math.min(
        requestedScale,
        maxDimension / Math.max(viewport.width, viewport.height, 1),
        Math.sqrt(8_000_000 / viewportPixels),
    );
    const width = Math.max(1, Math.round(viewport.width * backingScale));
    const height = Math.max(1, Math.round(viewport.height * backingScale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context is unavailable.");
    context.clearRect(0, 0, width, height);
    const circles = new Map(plan.circles.map((circle) => [circle.id, circle]));
    const mapScale = 2 ** viewport.zoom * backingScale;
    if (plan.expression !== null && plan.expression !== true) {
        if (plan.expression === false) {
            context.fillStyle = "rgba(0, 0, 0, 0.28)";
            context.fillRect(0, 0, width, height);
        } else {
            const mask = evaluateMask(
                plan.expression,
                circles,
                pool,
                width,
                height,
                viewport,
                mapScale,
            );
            context.fillStyle = "rgba(0, 0, 0, 0.28)";
            context.fillRect(0, 0, width, height);
            context.globalCompositeOperation = "destination-out";
            context.drawImage(mask as CanvasImageSource, 0, 0);
            context.globalCompositeOperation = "source-over";
            pool.release(mask);
        }
    }

    for (const circle of plan.circles) {
        context.save();
        createCirclePath(context, circle, viewport, mapScale);
        context.strokeStyle =
            circle.contribution === "contributing"
                ? "rgba(255, 255, 255, 0.72)"
                : "rgba(255, 255, 255, 0.3)";
        context.lineWidth = circle.contribution === "contributing" ? 1 : 1.5;
        context.setLineDash(
            circle.contribution === "contributing" ? [] : [5, 5],
        );
        context.stroke();
        context.restore();
    }
}
