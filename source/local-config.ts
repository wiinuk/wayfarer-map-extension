import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "./typed-event-target";

export type Config = import("zod").infer<LocalConfigAccessor["schema"]>;

export type LocalConfigAccessor = Awaited<
    ReturnType<typeof createConfigAccessor>
>;

export async function createConfigAccessor(key: string) {
    const zod = await import("https://cdn.jsdelivr.net/npm/zod@4.3.6/+esm");

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

    const ConfigSchema = zod
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

    type Config = import("zod").infer<typeof ConfigSchema>;
    const events = createTypedEventTarget<{ "config-changed": Config }>();
    const accessor = {
        getConfig(): Config {
            const jsonText = localStorage.getItem(key);
            if (jsonText == null) {
                const config = { version: "1" } as const satisfies Config;
                accessor.setConfig(config);
                return config;
            }
            return ConfigSchema.parse(JSON.parse(jsonText));
        },
        schema: ConfigSchema,
        setConfig(config: Config) {
            localStorage.setItem(key, JSON.stringify(config));
            events.dispatchEvent(
                createTypedCustomEvent("config-changed", config),
            );
        },
        events,
    };
    return accessor;
}
