import type { TypedEventTarget } from "./typed-event-target";

export interface PageEventMap {
    "gcs-received": undefined;
    "gcs-saved": undefined;
}
export type PageEventTarget = TypedEventTarget<PageEventMap>;
