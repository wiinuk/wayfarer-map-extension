import {
    createStandardQueries,
    type DraftQueryBuilder,
} from "../query/standard-queries";
import type { Draft } from "../remote";
import { done, forceAsPromise } from "../sal/effective";
import { evaluateExpression } from "../sal/evaluator";

export async function filterDrafts(
    drafts: readonly Draft[],
    source: string,
    signal: AbortSignal,
): Promise<Draft[]> {
    const queryGlobals = createStandardQueries();
    const effective = evaluateExpression(source, (k) => queryGlobals.get(k));
    const filter = await forceAsPromise(effective, signal);
    const queryBuilder = filter as unknown as DraftQueryBuilder;
    const query = await forceAsPromise(
        queryBuilder.initialize({
            getUserLocation() {
                return done({
                    lat: 0,
                    lng: 0,
                });
            },
        }),
        signal,
    );

    const result = [];
    let error = null;
    for (const d of drafts) {
        let isVisible = false;
        try {
            isVisible = await forceAsPromise(query.isVisible(d), signal);
        } catch (e) {
            error ??= e;
        }
        if (isVisible) {
            result.push(d);
        }
    }
    if (error) console.error(error);
    return result;
}
