import { done, type Effective } from "../sal/effective";

interface Command {
    readonly type: string;
}
interface CopyCommand extends Command {
    readonly type: "copy";
    readonly text: string;
}
interface OpenMapCommand extends Command {
    readonly type: "open-map";
    readonly lat: number;
    readonly lng: number;
    readonly title: string;
}
interface OpenLinkCommand extends Command {
    readonly type: "open-link";
    readonly url: string;
}
export type ActionCommand = CopyCommand | OpenMapCommand | OpenLinkCommand;
export interface Action {
    execute(text: string): Effective<ActionCommand>;
    readonly description: string;
}

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

export function createCopyCommand(text: string): CopyCommand {
    return {
        type: "copy",
        text,
    };
}
function createCopyMatch(index: number, length: number): ActionMatch {
    return {
        action: {
            description: "copy text to clipboard",
            execute(text) {
                return done(createCopyCommand(text));
            },
        },
        index,
        length,
    };
}

export function pattern(pattern: string): ActionRule {
    const regex = new RegExp(pattern, "gi");
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
