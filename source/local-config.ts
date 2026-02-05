import zod from "zod";

export type LocalConfigAccessor = ReturnType<typeof createConfigAccessor>;
export function createConfigAccessor(key: string) {
    const ConfigV1Schema = zod
        .strictObject({
            version: zod.literal("1"),
            userId: zod.string().optional(),
            apiRoot: zod.string().optional(),
        })
        .readonly();

    type ConfigV1 = zod.infer<typeof ConfigV1Schema>;

    const ConfigSchema = ConfigV1Schema;
    type Config = ConfigV1;

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
        },
    };
}
