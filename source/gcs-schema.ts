import * as z from "zod";

const FormatSchema = z.enum([
    "DETAILED",
]);
export type Format = z.infer<typeof FormatSchema>;


const EntityKindSchema = z.enum([
    "GYM",
    "POKESTOP",
    "POWERSPOT",
]);
export type EntityKind = z.infer<typeof EntityKindSchema>;


const GameBrandSchema = z.enum([
    "HOLOHOLO",
]);
export type GameBrand = z.infer<typeof GameBrandSchema>;


const StatusSchema = z.enum([
    "ACTIVE",
    "INACTIVE",
]);
export type Status = z.infer<typeof StatusSchema>;

const latLngStringPattern = /^\(\s*-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?\s*\)$/;

/** e.g. `"(35.681154537878946,139.76807615735552)"` */
const LatLngStringSchema = z
    .string()
    .transform((text, context) => {
        const match = latLngStringPattern.exec(text);
        if (!match) {
            context.addIssue({
                code: "invalid_format",
                message: "Invalid point format. Expected `(${number},${number})",
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

export const GcsQueriesSchema = z.object({
    "ne": LatLngStringSchema,
    "sw": LatLngStringSchema,
});
export type GcsQueries = z.infer<typeof GcsQueriesSchema>;

const MetadataSchema = z.object({
    "s2CellLevel": z.number(),
    /** e.g. `"60188bf94"` */
    "s2CellId": z.string(),
    /** e.g. `"1769695998405"` */
    "generatedTimestamp": z.string(),
    "count": z.number(),
    "format": FormatSchema,
});
export type Metadata = z.infer<typeof MetadataSchema>;

const GmoSchema = z.object({
    "gameBrand": GameBrandSchema,
    "entity": EntityKindSchema,
    "status": StatusSchema,
});
export type Gmo = z.infer<typeof GmoSchema>;

const PoiSchema = z.object({
    /** e.g. `"503fb825a42d489b9b78870dd20b9387.23"` */
    "poiId": z.string(),
    /** e.g. `139772431` */
    "latE6": z.number(),
    /** e.g. `35675825` */
    "lngE6": z.number(),
    "title": z.string(),
    "description": z.string(),
    /** e.g. `"2-chōme-13-11 Kyōbashi, Chuo City, Tokyo 104-0031, Japan, Chuo City, 104-0031, JP"` */
    "address": z.string(),
    "categoryTags": z.array(z.unknown()),
    /** e.g. `"https://lh3.googleusercontent.com/…"` */
    "mainImage": z.string(),
    "hasAdditionalImages": z.boolean(),
    "gmo": z.array(GmoSchema),
    "isCommunityContributed": z.boolean(),
});
export type Poi = z.infer<typeof PoiSchema>;

const DatumSchema = z.object({
    "metadata": MetadataSchema,
    "pois": z.array(PoiSchema),
    "clusters": z.array(z.unknown()),
});
export type Datum = z.infer<typeof DatumSchema>;

const ResultSchema = z.object({
    "success": z.boolean(),
    "data": z.array(DatumSchema),
    "cellsQueried": z.number(),
    "cellsLoaded": z.number(),
    "snapshot": z.string(),
    "cellLevel": z.number(),
});
export type Result = z.infer<typeof ResultSchema>;

export const GcsResponseSchema = z.object({
    "result": ResultSchema,
    /** e.g. `null` */
    "message": z.unknown(),
    "code": z.string(),
    /** e.g. `null` */
    "errorsWithIcon": z.unknown(),
    /** e.g. `null` */
    "fieldErrors": z.unknown(),
    /** e.g. `null` */
    "errorDetails": z.unknown(),
    "version": z.string(),
    "captcha": z.boolean(),
});
export type GcsResponse = z.infer<typeof GcsResponseSchema>;
