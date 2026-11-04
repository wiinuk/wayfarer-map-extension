import { describe, expect, it } from "vitest";
import {
    evaluateLint,
    type LintInput,
    type LintMatch,
    type LintRegexRunner,
} from "./lint";

const signal = () => new AbortController().signal;
const runRegex: LintRegexRunner = async (source, text, abortSignal) => {
    if (abortSignal.aborted) throw abortSignal.reason;
    const matches: LintMatch[] = [];
    for (const match of text.matchAll(new RegExp(source, "gm"))) {
        const captures: Record<string, string> = {};
        for (const [name, value] of Object.entries(match.groups ?? {})) {
            captures[name] = value;
        }
        matches.push({
            from: match.index,
            to: match.index + match[0].length,
            text: match[0],
            captures,
        });
    }
    return matches;
};

describe("Sal Lint", () => {
    it("reports missing suffixes at LF, CRLF, and CR line endings", async () => {
        const diagnostics = await evaluateLint(
            `missing-suffix:"。" /report "句点を付けてください" /fix "。" /in description`,
            {
                fields: { description: "一行\r\n二行。\n\n三行\r終わり" },
            },
            signal(),
            runRegex,
        );

        expect(diagnostics.map(({ from, to, fix }) => [from, to, fix])).toEqual(
            [
                [
                    2,
                    2,
                    [{ location: "description", from: 2, to: 2, insert: "。" }],
                ],
                [
                    11,
                    11,
                    [
                        {
                            location: "description",
                            from: 11,
                            to: 11,
                            insert: "。",
                        },
                    ],
                ],
                [
                    15,
                    15,
                    [
                        {
                            location: "description",
                            from: 15,
                            to: 15,
                            insert: "。",
                        },
                    ],
                ],
            ],
        );
    });

    it("matches named captures to find missing and duplicate annotations", async () => {
        const input: LintInput = {
            fields: { note: "※[1]\n※[2]\n※[1]: one\n※[1]: duplicate" },
        };
        const diagnostics = await evaluateLint(
            `(
                (unmatched:references:definitions /report "定義なし")
                and (duplicates:definitions /report "重複")
            )
            @where references = pattern:"※\\\\[(?<number>[0-9]+)\\\\](?!:)"
            @where definitions = pattern:"^※\\\\[(?<number>[0-9]+)\\\\]:[^\\\\r\\\\n]+$"`,
            input,
            signal(),
            runRegex,
        );

        expect(diagnostics.map(({ message, from }) => [message, from])).toEqual(
            [
                ["定義なし", 5],
                ["重複", 20],
            ],
        );
    });

    it("only returns matches from both matchers when each has a match", async () => {
        const diagnostics = await evaluateLint(
            `(both:first:second /report "混在") @where first = pattern:"polite" @where second = pattern:"plain"`,
            {
                fields: {
                    description: "polite plain",
                    note: "plain",
                    title: "plain only",
                },
            },
            signal(),
            runRegex,
        );

        expect(diagnostics).toHaveLength(2);
        expect(diagnostics.map(({ location }) => location)).toEqual([
            "description",
            "description",
        ]);
    });

    it("returns suggestions as a single selectable edit group", async () => {
        const diagnostics = await evaluateLint(
            `pattern:"wrong" /report "選んでください" /suggest @function input diagnostic: [{label:"修正", edits:[{location:"note", from:0, to:5, insert:"right"}]}]`,
            { fields: { note: "wrong" } },
            signal(),
            runRegex,
        );

        expect(diagnostics[0]?.suggestions).toEqual([
            {
                label: "修正",
                edits: [
                    {
                        location: "note",
                        from: 0,
                        to: 5,
                        insert: "right",
                    },
                ],
            },
        ]);
    });

    it("adds locations across repeated /in modifiers and supports warnings", async () => {
        const diagnostics = await evaluateLint(
            `(pattern:"x" /report "warning" /severity warning /in description /in note)`,
            {
                fields: {
                    title: "x",
                    description: "x",
                    note: "x",
                },
            },
            signal(),
            runRegex,
        );

        expect(
            diagnostics.map(({ location, severity }) => [location, severity]),
        ).toEqual([
            ["description", "warning"],
            ["note", "warning"],
        ]);
    });

    it("rejects malformed regular expressions and invalid locations", async () => {
        await expect(
            evaluateLint(
                `pattern:"(" /report "bad"`,
                { fields: { note: "text" } },
                signal(),
                runRegex,
            ),
        ).rejects.toThrow();
        await expect(
            evaluateLint(
                `pattern:"x" /report "bad" /in title-ish`,
                { fields: { note: "text" } },
                signal(),
                runRegex,
            ),
        ).rejects.toThrow("Unknown Lint location");
        await expect(
            evaluateLint(
                `(unmatched:left:right /report "bad") @where left = pattern:"x" @where right = pattern:"y"`,
                { fields: { note: "" } },
                signal(),
                runRegex,
            ),
        ).rejects.toThrow("named capture");
    });
});
