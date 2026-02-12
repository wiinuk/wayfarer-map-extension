import zod from "zod";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "./typed-event-target";

export type LocalConfigAccessor = ReturnType<typeof createConfigAccessor>;

const QuerySourceSchema = zod
    .strictObject({
        id: zod.string(),
        contents: zod.string(),
    })
    .readonly();

const SourceWithSelectionSchema = zod
    .strictObject({
        selectedIndex: zod.number().nullable(),
        sources: zod
            .tuple([QuerySourceSchema])
            .rest(QuerySourceSchema)
            .readonly(),
    })
    .readonly();

export const ConfigSchema = zod
    .strictObject({
        version: zod.literal("1"),
        userId: zod.string().optional(),
        apiRoot: zod.string().optional(),
        sources: SourceWithSelectionSchema.optional(),
        dictionaries: zod
            .record(zod.string(), zod.record(zod.string(), zod.string()))
            .optional(),
    })
    .readonly();

export type Config = zod.infer<typeof ConfigSchema>;

export function createConfigAccessor(key: string) {
    const events = createTypedEventTarget<{ "config-changed": Config }>();
    return {
        getConfig(): Config {
            const jsonText = localStorage.getItem(key);
            if (jsonText == null) {
                const config = { version: "1" } satisfies Config;
                this.setConfig(config);
                return config;
            }
            return ConfigSchema.parse(JSON.parse(jsonText));
        },
        setConfig(config: Config) {
            localStorage.setItem(key, JSON.stringify(config));
            events.dispatchEvent(
                createTypedCustomEvent("config-changed", config),
            );
        },
        events,
    };
}
