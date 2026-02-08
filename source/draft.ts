import type { Draft } from "./remote";

export function setDraftIsTemplate(draft: Draft, isTemplate: boolean) {
    draft.data["isTemplate"] = isTemplate || undefined;
}
export function getDraftIsTemplate(draft: Draft) {
    return draft.data["isTemplate"] === true;
}

function pad2(value: number) {
    return ("00" + value).slice(-2);
}
function getIsoTodayString(date: Date) {
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    return `${yyyy}-${mm}-${dd}`;
}
function getIsoTimeString(date: Date) {
    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    const seconds = pad2(date.getSeconds());
    return `${hours}:${minutes}:${seconds}`;
}
function getIsoTimeZoneString(date: Date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const hours = pad2(offset / 60);
    const minutes = pad2(offset % 60);
    return `${sign}${hours}:${minutes}`;
}
function getIsoDateTimeString(date: Date, withTimeZone = false) {
    return `${getIsoTodayString(date)}T${getIsoTimeString(date)}${
        withTimeZone ? getIsoTimeZoneString(date) : ""
    }`;
}
function resolveStandardVariable(name: string) {
    switch (name) {
        case "today":
            return getIsoTodayString(new Date());
        case "now":
            return getIsoDateTimeString(new Date());
        case "nowWithTimeZone":
            return getIsoDateTimeString(new Date(), true);
    }
}
const interpolationPattern = /\\\(\s*([a-zA-Z_$][a-zA-Z_$0-9]*)\s*\)/g;
export function applyTemplate(
    template: string,
    resolve?: (name: string) => string | undefined,
) {
    return template.replace(
        interpolationPattern,
        (interpolation, variableName) =>
            resolve?.(variableName) ??
            resolveStandardVariable(variableName) ??
            interpolation,
    );
}
