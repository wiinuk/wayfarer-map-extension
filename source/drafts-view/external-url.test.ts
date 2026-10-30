import { describe, expect, it } from "vitest";
import { evaluateExternalUrls } from "./external-url";

describe("external URL Sal settings", () => {
    it("builds labeled URLs from candidate data and combines them with and", async () => {
        const source = `
            new-draft and update-draft and register-9db
            @where new-draft = open:"下書き新規作成":(@fn r:
                "https://wayfarer.scopely.com/submit/new#data="
                to-data-url:r
            )
            @where update-draft = open:"下書き更新":(@fn r:
                "https://wayfarer.scopely.com/submit#update="
                to-data-url:r
            )
            @where to-data-url = (@fn r:
                {
                    lat: r /get lat,
                    lng: r /get lng,
                    title: r /get title,
                    description: r /get description,
                    statement: statement,
                }
                /pipe json-stringify
                /pipe encode-url-component
                @where statement =
                    r
                    /get note
                    /pipe trim-end
                    /pipe last-line
            )
            @where register-9db = open:"9db登録":(@fn r:
                "https://9db.jp/pokemongo/map#"
                get:r:lat "," get:r:lng ",17,"
                encode-url-component:(get:r:title)
            )
        `;
        const options = await evaluateExternalUrls(
            source,
            {
                lat: 35.6,
                lng: 139.7,
                title: "候補名",
                description: "説明",
                note: "前の行\r\n補足\r\n\r\n  ",
            },
            new AbortController().signal,
        );

        expect(options).toStrictEqual([
            {
                label: "下書き新規作成",
                url: `https://wayfarer.scopely.com/submit/new#data=${encodeURIComponent(
                    JSON.stringify({
                        lat: 35.6,
                        lng: 139.7,
                        title: "候補名",
                        description: "説明",
                        statement: "補足",
                    }),
                )}`,
            },
            {
                label: "下書き更新",
                url: `https://wayfarer.scopely.com/submit#update=${encodeURIComponent(
                    JSON.stringify({
                        lat: 35.6,
                        lng: 139.7,
                        title: "候補名",
                        description: "説明",
                        statement: "補足",
                    }),
                )}`,
            },
            {
                label: "9db登録",
                url: `https://9db.jp/pokemongo/map#35.6,139.7,17,${encodeURIComponent(
                    "候補名",
                )}`,
            },
        ]);
    });
});
