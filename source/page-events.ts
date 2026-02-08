import { id, withTag, type Id, type Tagged } from "./standard-extensions";
import type {
    DefinitionToMap,
    DefinitionToTypes,
    TypedEventTarget,
} from "./typed-event-target";

function eventType<T, E>(type: T, _: Id<E>): Tagged<T, E> {
    return withTag(type);
}
const pageEventDefinition = [
    eventType("config-changed", id<undefined>),
    eventType("gcs-received", id<undefined>),
    eventType("gcs-saved", id<undefined>),
] as const;

export type PageEventTypes = DefinitionToTypes<typeof pageEventDefinition>;
export const pageEventTypes: PageEventTypes = pageEventDefinition;
export type PageEventMap = DefinitionToMap<typeof pageEventDefinition>;
export type PageEventTarget = TypedEventTarget<PageEventMap>;
