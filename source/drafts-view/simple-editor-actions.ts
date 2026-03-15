import { done, type Effective } from "../sal/effective";

interface CopyCommand {
    readonly type: "copy";
    readonly text: string;
}
interface OpenMapCommand {
    readonly type: "open-map";
    readonly lat: number;
    readonly lng: number;
    readonly title: string;
}
interface OpenLinkCommand {
    readonly type: "open-link";
    readonly url: string;
}
export type ActionCommand = CopyCommand | OpenMapCommand | OpenLinkCommand;
export type Action = (text: string) => Effective<ActionCommand>;

export interface ActionMatch {
    readonly index: number;
    readonly length: number;
    readonly action: Action;
}

export type ActionLocation = "description" | "note";
interface ActionSource {
    readonly text: string;
    readonly location: ActionLocation;
}
export interface ActionRule {
    readonly match: (source: ActionSource) => Effective<readonly ActionMatch[]>;
}

export function bindAction(rule: ActionRule, action: Action): ActionRule {
    return {
        *match(source) {
            return (yield* rule.match(source)).map((m) => ({
                ...m,
                action,
            }));
        },
    };
}

export function withLocation(
    rule: ActionRule,
    location: ActionLocation,
): ActionRule {
    return {
        match(source) {
            if (source.location === location) return rule.match(source);

            return done([]);
        },
    };
}

function createCopyMatch(index: number, length: number): ActionMatch {
    return {
        action(text) {
            return done({
                type: "copy",
                text,
            });
        },
        index,
        length,
    };
}

export function pattern(pattern: string): ActionRule {
    const regex = new RegExp(pattern, "g");
    return {
        match({ text }: ActionSource) {
            const matches: ActionMatch[] = [];
            for (const m of text.matchAll(regex)) {
                matches.push(createCopyMatch(m.index, m[0].length));
            }
            return done(matches);
        },
    };
}
export function mergeRule(rule1: ActionRule, rule2: ActionRule): ActionRule {
    return {
        *match(source) {
            return [
                ...(yield* rule1.match(source)),
                ...(yield* rule2.match(source)),
            ];
        },
    };
}
