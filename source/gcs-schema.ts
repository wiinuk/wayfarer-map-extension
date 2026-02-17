export type GcsSchemas = Awaited<ReturnType<typeof createGcsSchemas>>;
type Infer<Name extends keyof GcsSchemas> = import("zod").infer<
    GcsSchemas[Name]
>;

export type Format = Infer<"FormatSchema">;
export type EntityKind = Infer<"EntityKindSchema">;
export type GameBrand = Infer<"GameBrandSchema">;
export type Status = Infer<"StatusSchema">;
export type GcsQueries = Infer<"GcsQueriesSchema">;
export type Metadata = Infer<"MetadataSchema">;
export type Gmo = Infer<"GmoSchema">;
export type Poi = Infer<"PoiSchema">;
export type Datum = Infer<"DatumSchema">;
export type Result = Infer<"ResultSchema">;
export type GcsResponse = Infer<"GcsResponseSchema">;

export async function createGcsSchemas() {
    const z = await import("https://cdn.jsdelivr.net/npm/zod@4.3.6/+esm");

    const FormatSchema = z.enum(["DETAILED"]);
    const EntityKindSchema = z.enum(["GYM", "POKESTOP", "POWERSPOT"]);
    const GameBrandSchema = z.enum(["HOLOHOLO"]);
    const StatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

    const latLngStringPattern =
        /^\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\)$/;

    /** e.g. `"(35.681154537878946,139.76807615735552)"` */
    const LatLngStringSchema = z.string().transform((text, context) => {
        const match = latLngStringPattern.exec(text);
        if (!match) {
            context.addIssue({
                code: "invalid_format",
                message:
                    "Invalid point format. Expected `(${number},${number})",
                format: "custom",
                pattern: latLngStringPattern.source,
                input: text,
            });
            return z.NEVER;
        }

        return {
            lat: Number(match[1]),
            lng: Number(match[2]),
        };
    });

    const GcsQueriesSchema = z.object({
        ne: LatLngStringSchema,
        sw: LatLngStringSchema,
    });

    const MetadataSchema = z.object({
        s2CellLevel: z.number(),
        /** e.g. `"60188bf94"` */
        s2CellId: z.string(),
        /** e.g. `"1769695998405"` */
        generatedTimestamp: z.string(),
        count: z.number(),
        format: FormatSchema,
    });

    const GmoSchema = z.object({
        gameBrand: GameBrandSchema,
        entity: EntityKindSchema,
        status: StatusSchema,
    });

    const PoiSchema = z.object({
        /** e.g. `"503fb825a42d489b9b78870dd20b9387.23"` */
        poiId: z.string(),
        /** e.g. `139772431` */
        latE6: z.number(),
        /** e.g. `35675825` */
        lngE6: z.number(),
        title: z.string(),
        description: z.string(),
        /** e.g. `"2-chōme-13-11 Kyōbashi, Chuo City, Tokyo 104-0031, Japan, Chuo City, 104-0031, JP"` */
        address: z.string(),
        categoryTags: z.array(z.unknown()),
        /** e.g. `"https://lh3.googleusercontent.com/…"` */
        mainImage: z.string(),
        hasAdditionalImages: z.boolean(),
        gmo: z.array(GmoSchema),
        isCommunityContributed: z.boolean(),
    });

    const DatumSchema = z.object({
        metadata: MetadataSchema,
        pois: z.array(PoiSchema),
        clusters: z.array(z.unknown()),
    });

    const ResultSchema = z.object({
        success: z.boolean(),
        data: z.array(DatumSchema),
        cellsQueried: z.number(),
        cellsLoaded: z.number(),
        snapshot: z.string(),
        cellLevel: z.number(),
    });

    const GcsResponseSchema = z.object({
        result: ResultSchema,
        /** e.g. `null` */
        message: z.unknown(),
        code: z.string(),
        /** e.g. `null` */
        errorsWithIcon: z.unknown(),
        /** e.g. `null` */
        fieldErrors: z.unknown(),
        /** e.g. `null` */
        errorDetails: z.unknown(),
        version: z.string(),
        captcha: z.boolean(),
    });

    return {
        FormatSchema,
        EntityKindSchema,
        GameBrandSchema,
        StatusSchema,
        MetadataSchema,
        GmoSchema,
        PoiSchema,
        DatumSchema,
        ResultSchema,

        GcsQueriesSchema,
        GcsResponseSchema,

        parseGcsResponse(responseText: string) {
            return GcsResponseSchema.parse(JSON.parse(responseText));
        },
        parseGcsQueries(queries: unknown) {
            return GcsQueriesSchema.parse(queries);
        },
    };
}
