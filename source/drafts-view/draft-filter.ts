import type { Draft } from "../remote";
import { sleep } from "../standard-extensions";

function hasTermInString(text: string, term: string): boolean {
    return text.toLowerCase().includes(term);
}

function hasTermInDraft(
    { name, description, note }: Draft,
    term: string,
): boolean {
    return (
        hasTermInString(name, term) ||
        hasTermInString(description, term) ||
        hasTermInString(note, term)
    );
}

function filterDraftsSync(drafts: readonly Draft[], query: string): Draft[] {
    const searchAndTerms = query.toLowerCase().match(/[^ ]+/g) ?? [""];

    // クエリが空文字列や空白のみの場合は、全てのドラフトを返す
    if (searchAndTerms.length === 1 && searchAndTerms[0] === "") {
        return [...drafts];
    }

    return drafts.filter((draft) => {
        for (const term of searchAndTerms) {
            if (!hasTermInDraft(draft, term)) return false;
        }
        return true;
    });
}

export async function filterDrafts(
    drafts: readonly Draft[],
    query: string,
    signal: AbortSignal,
): Promise<Draft[]> {
    await sleep(0, { signal });
    return filterDraftsSync(drafts, query);
}
