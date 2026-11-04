interface RegexRequest {
    readonly id: number;
    readonly pattern: string;
    readonly text: string;
}

interface RegexMatch {
    readonly from: number;
    readonly to: number;
    readonly text: string;
    readonly captures: Readonly<Record<string, string>>;
}

interface RegexResponse {
    readonly id: number;
    readonly matches?: readonly RegexMatch[];
    readonly error?: string;
}

self.addEventListener("message", ({ data }: MessageEvent<RegexRequest>) => {
    const { id, pattern, text } = data;
    try {
        const regex = new RegExp(pattern, "gmu");
        const matches: RegexMatch[] = [];
        for (const match of text.matchAll(regex)) {
            const captures: Record<string, string> = Object.create(null);
            for (const [name, value] of Object.entries(match.groups ?? {})) {
                captures[name] = value;
            }
            matches.push({
                from: match.index,
                to: match.index + match[0].length,
                text: match[0],
                captures,
            });
            if (matches.length > 1000) {
                throw new Error("Lint matcher exceeds the 1000 match limit");
            }
        }
        self.postMessage({ id, matches } satisfies RegexResponse);
    } catch (reason) {
        self.postMessage({
            id,
            error:
                reason instanceof Error
                    ? reason.message
                    : "Lint regular expression failed",
        } satisfies RegexResponse);
    }
});
