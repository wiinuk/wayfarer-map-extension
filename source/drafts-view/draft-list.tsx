import classNames, { cssText } from "./draft-list.module.css";
import { createVirtualList, type VirtualElements } from "./virtual-list";
import type { DraftsOverlay } from "../drafts-overlay";
import type { LatLng } from "../s2";
import type { Draft, Remote } from "../remote";
import type { LocalConfigAccessor } from "../local-config";
import { coordinatesToString, parseCoordinates } from "../geometry";
import {
    applyTemplate,
    getDraftIsTemplate,
    setDraftIsTemplate,
} from "../draft";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../typed-event-target";
import { createDialog } from "./dialog";
import { createLocalConfigView } from "../local-config-view/local-config-view";
import { createFilterBar } from "./query-view/filter-bar";
import { styleSetter } from "../dom-extensions";
import { createSourceList } from "./query-view/source-list";
import { filterDrafts } from "./draft-filter";
import { createAsyncCancelScope, sleep } from "../standard-extensions";
import { createEditor, type SalDiagnostic } from "./query-view/editor";
import type { PoiRecords } from "../poi-records";
import { SalEvaluationError } from "../sal/evaluator";
import { createSimpleEditor } from "./simple-editor";
import type { Geo } from "../geo";
import { evaluateExternalUrls, type ExternalUrlData } from "./external-url";
import {
    evaluateLint,
    type LintDiagnostic,
    type LintInput,
    type LintLocation,
    type LintTextEdit,
} from "./lint";

interface DraftListOptions {
    readonly overlay: DraftsOverlay;
    readonly remote: Remote;
    readonly records: PoiRecords;
    readonly local: LocalConfigAccessor;
    readonly geo: Geo;
    readonly handleAsyncError: (reason: unknown) => void;
}
interface DraftListEventMap {
    "count-changed": {
        totalCount: number;
        filteredCount: number;
    };
    "filter-start": undefined;
    "filter-end": undefined;
}

export interface QuerySource {
    readonly id: string;
    readonly contents: string;
}
export interface SourcesWithSelection {
    readonly sources: readonly [QuerySource, ...QuerySource[]];
    readonly selectedIndex: number | null;
    readonly activeSalActionSourceId?: string | null;
    readonly activeSalOpenSourceId?: string | null;
    readonly activeSalLintSourceId?: string | null;
}

function newFreshId(baseName: string, definedIds: readonly string[]) {
    const names = new Set(definedIds);
    for (let i = 2; ; i++) {
        const id = `${baseName}${i}`;
        if (!names.has(id)) return id;
    }
}

type Drop<
    T extends readonly unknown[],
    N extends number,
    Acc extends unknown[] = [],
> = Acc["length"] extends N
    ? T
    : T extends readonly [unknown, ...infer Rest]
      ? Drop<Rest, N, [...Acc, unknown]>
      : [];

function toSpliced<
    const T extends readonly unknown[],
    D extends number,
    const I extends unknown[],
>(array: T, start: number, deleteCount: D, ...items: I) {
    const result = [...array];
    result.splice(start, deleteCount, ...items);
    return result as Drop<[...T, ...I], D>;
}

type AtLeast<
    T,
    L extends number,
    Acc extends unknown[] = [],
> = Acc["length"] extends L ? [...Acc, ...T[]] : AtLeast<T, L, [...Acc, T]>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MatchReadonly<Input, Target> = Input extends any[]
    ? Target
    : Readonly<Target>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasMinLength<T extends readonly any[], L extends number>(
    items: T,
    length: L,
): items is T & MatchReadonly<T, AtLeast<T[number], L>> {
    return items.length >= length;
}

function isTrivial(
    { id, contents }: QuerySource,
    { sources }: SourcesWithSelection,
) {
    return (
        contents === "" ||
        contents.length <= 1 ||
        sources.find((s) => s.id !== id && s.contents === contents)
    );
}

function isAndroid(): boolean {
    return /android/i.test(navigator.userAgent);
}

function getGoogleMapsUrl({ lat, lng }: LatLng, title: string) {
    return isAndroid()
        ? // &z=${zoom}
          `intent://0,0?q=${lat},${lng}%20(${encodeURIComponent(title)})#Intent;scheme=geo;package=com.google.android.apps.maps;end`
        : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

const setStyle = styleSetter(cssText);
export async function createDraftList({
    overlay,
    remote,
    records,
    local,
    geo,
    handleAsyncError,
}: DraftListOptions) {
    setStyle();

    const events = createTypedEventTarget<DraftListEventMap>();
    let allDrafts: Draft[] = Array.from(overlay.drafts.values()).map(
        (view) => view.draft,
    );
    let filteredDrafts: Draft[] = [...allDrafts];
    let selectedDraft: Draft | null = null;
    let currentSources: SourcesWithSelection = local.getConfig().sources || {
        selectedIndex: 0,
        sources: [{ id: "source0", contents: "" }],
    };

    const defaultSalSource = `pattern:("https://" many1:(not-space)) /to open`;

    let activeRuleSourceId: string | null =
        currentSources.activeSalActionSourceId ?? null;
    let activeRuleSource =
        currentSources.sources.find((s) => s.id === activeRuleSourceId)
            ?.contents ?? defaultSalSource;
    let activeOpenSourceId = currentSources.activeSalOpenSourceId ?? null;
    let activeOpenSource =
        currentSources.sources.find((s) => s.id === activeOpenSourceId)
            ?.contents ?? "";
    let activeLintSourceId = currentSources.activeSalLintSourceId ?? null;
    let activeLintSource =
        currentSources.sources.find((s) => s.id === activeLintSourceId)
            ?.contents ?? "";

    const sourceList = createSourceList({ initialList: currentSources });
    const sourceListDialog = createDialog(sourceList.element, {
        title: "検索一覧",
    });

    const editor = await createEditor({
        initialFileName: getSelectedSourceId() ?? "",
        initialText: getSelectedSource() ?? "",
        initialActiveSalActionSourceId: activeRuleSourceId,
        initialActiveSalOpenSourceId: activeOpenSourceId,
        initialActiveSalLintSourceId: activeLintSourceId,
    });
    const editorDialog = createDialog(editor.element, {
        title: "検索ワードを編集",
    });

    sourceList.events.addEventListener("select", ({ detail: index }) => {
        setCurrentSourcesAndNotify({
            ...currentSources,
            selectedIndex: index,
        });
    });
    sourceList.events.addEventListener("delete", ({ detail: index }) => {
        const oldSource = currentSources.sources[index];
        if (oldSource == null || !hasMinLength(currentSources.sources, 2)) {
            return;
        }
        const oldSources: readonly [
            QuerySource,
            QuerySource,
            ...QuerySource[],
        ] = currentSources.sources;

        if (
            !isTrivial(oldSource, currentSources) &&
            !confirm(
                `本当に ${JSON.stringify(
                    oldSource.contents,
                )} (id: ${JSON.stringify(oldSource.id)}) を削除しますか？`,
            )
        ) {
            return;
        }

        const newSources = toSpliced(oldSources, index, 1);
        const newIndex =
            currentSources.sources.length === 0
                ? null
                : currentSources.sources.length <= index + 1
                  ? index - 1
                  : index;

        setCurrentSourcesAndNotify({
            ...currentSources,
            selectedIndex: newIndex,
            sources: newSources,
        });
    });
    sourceList.events.addEventListener("add", () => {
        const id = newFreshId(
            "source",
            currentSources.sources.map((s) => s.id),
        );
        const contents = getSelectedSource() ?? "";
        const newSource = { id, contents };
        const index =
            currentSources.selectedIndex === null
                ? 0
                : currentSources.selectedIndex + 1;
        const sources = toSpliced(currentSources.sources, index, 0, newSource);

        setCurrentSourcesAndNotify({
            ...currentSources,
            selectedIndex: index,
            sources,
        });
    });
    editor.events.addEventListener("input", ({ detail: value }) => {
        setSelectedSourceAndNotify(value, false);
    });

    editor.events.addEventListener(
        "sal-action-source-changed",
        ({ detail }) => {
            activeRuleSourceId = detail.sourceId;
            currentSources = {
                ...currentSources,
                activeSalActionSourceId: activeRuleSourceId,
            };
            local.setConfig({ ...local.getConfig(), sources: currentSources });

            if (activeRuleSourceId == null) {
                activeRuleSource = defaultSalSource;
            } else {
                const source = currentSources.sources.find(
                    (s) => s.id === activeRuleSourceId,
                );
                activeRuleSource = source?.contents ?? defaultSalSource;
            }
            descriptionEditor.updateRuleSource(activeRuleSource);
            noteEditor.updateRuleSource(activeRuleSource);
        },
    );
    editor.events.addEventListener("sal-open-source-changed", ({ detail }) => {
        activeOpenSourceId = detail.sourceId;
        currentSources = {
            ...currentSources,
            activeSalOpenSourceId: activeOpenSourceId,
        };
        activeOpenSource =
            currentSources.sources.find(
                (source) => source.id === activeOpenSourceId,
            )?.contents ?? "";
        local.setConfig({ ...local.getConfig(), sources: currentSources });
        updateOpenMapLinks();
    });
    editor.events.addEventListener("sal-lint-source-changed", ({ detail }) => {
        activeLintSourceId = detail.sourceId;
        currentSources = {
            ...currentSources,
            activeSalLintSourceId: activeLintSourceId,
        };
        activeLintSource =
            currentSources.sources.find(
                (source) => source.id === activeLintSourceId,
            )?.contents ?? "";
        local.setConfig({ ...local.getConfig(), sources: currentSources });
        updateLint();
    });

    function setCurrentSourcesAndNotify(
        newSources: typeof currentSources,
        updateEditor = true,
    ) {
        currentSources = newSources;
        activeRuleSource =
            currentSources.sources.find(
                (source) => source.id === activeRuleSourceId,
            )?.contents ?? defaultSalSource;
        activeOpenSource =
            currentSources.sources.find(
                (source) => source.id === activeOpenSourceId,
            )?.contents ?? "";
        activeLintSource =
            currentSources.sources.find(
                (source) => source.id === activeLintSourceId,
            )?.contents ?? "";
        sourceList.setSources(currentSources);
        const selectedSourceId = getSelectedSourceId() ?? "";
        const selectedSource = getSelectedSource() ?? "";

        // 選択中のソースが更新されたかもしれないので処理
        filterInput.setValue(selectedSource);
        requestFilterUpdate();

        if (updateEditor) {
            editor.setSource(selectedSourceId, selectedSource);
        }
        descriptionEditor.updateRuleSource(activeRuleSource);
        noteEditor.updateRuleSource(activeRuleSource);
        updateOpenMapLinks();
        updateLint();
        local.setConfig({ ...local.getConfig(), sources: currentSources });
    }
    function getSelectedSource() {
        return currentSources.sources[currentSources.selectedIndex ?? -1]
            ?.contents;
    }
    function getSelectedSourceId() {
        return currentSources.sources[currentSources.selectedIndex ?? -1]?.id;
    }
    function setSelectedSourceAndNotify(
        newContents: string,
        updateEditor = true,
    ) {
        const index = currentSources.selectedIndex ?? -1;
        const source = currentSources.sources[index];
        if (source == null) return;

        const sources = toSpliced(currentSources.sources, index, 1, {
            ...source,
            contents: newContents,
        }) as QuerySource[] as [QuerySource, ...QuerySource[]]; // 削除して追加するので元と同じ

        setCurrentSourcesAndNotify(
            { ...currentSources, sources },
            updateEditor,
        );
    }

    overlay.events.addEventListener("selection-changed", ({ detail: id }) => {
        if (id == null) {
            selectedDraft = null;
        } else {
            const draft = allDrafts.find((x) => x.id === id);
            if (draft == null) return;
            selectedDraft = draft;
        }
        updateDetailPane();
        updateVirtualList();
    });
    overlay.events.addEventListener("draft-updated", ({ detail: id }) => {
        const draft = allDrafts.find((x) => x.id === id);
        if (draft == null) return;

        updateDetailPane();
        updateVirtualList();
        saveDraftChanges(draft);
    });

    const dispatchCountUpdatedEvent = () => {
        events.dispatchEvent(
            createTypedCustomEvent("count-changed", {
                totalCount: allDrafts.length,
                filteredCount: filteredDrafts.length,
            }),
        );
    };
    dispatchCountUpdatedEvent();

    const saveDraftChanges = (draft: Draft) => {
        const { apiRoot, userId } = local.getConfig();
        if (!apiRoot || !userId) return;

        remote.set(
            {
                type: "route",
                "user-id": userId,
                "route-id": draft.id,
                "route-name": draft.name,
                coordinates: coordinatesToString(draft.coordinates),
                description: draft.description,
                note: draft.note,
                data: JSON.stringify(draft.data),
            },
            apiRoot,
        );
    };

    const { element: virtualListElement, setItems: setVirtualListItems } =
        createVirtualList();

    const filterInput = createFilterBar({ value: getSelectedSource() ?? "" });

    filterInput.events.addEventListener("input-changed", () => {
        setSelectedSourceAndNotify(filterInput.getValue());
    });

    filterInput.events.addEventListener("click-list-button", () => {
        sourceListDialog.show();
    });
    filterInput.events.addEventListener("click-edit-button", () => {
        editorDialog.show();
    });

    const detailName = (
        <input
            type="text"
            value=""
            classList={[classNames["detail-name"], classNames["input-field"]]}
            oninput={(event) => {
                if (!selectedDraft) return;
                selectedDraft.name = (event.target as HTMLInputElement).value;
                overlay.updateDraftTitle(selectedDraft);
                updateOpenMapLinks();
                updateVirtualList();
                saveDraftChanges(selectedDraft);
                updateLint();
            }}
        />
    ) as HTMLInputElement;

    const descriptionEditor = createSimpleEditor({
        initialDoc: "",
        onInput(value) {
            if (!selectedDraft) return;
            selectedDraft.description = value;
            updateOpenMapLinks();
            saveDraftChanges(selectedDraft);
            updateLint();
        },
        location: "description",
        handleAsyncError,
        ruleSource: activeRuleSource,
        classNames: [classNames["detail"], classNames["input-field"]],
    });

    const noteEditor = createSimpleEditor({
        initialDoc: "",
        onInput(value) {
            if (!selectedDraft) return;
            selectedDraft.note = value;
            updateOpenMapLinks();
            saveDraftChanges(selectedDraft);
            updateLint();
        },
        location: "note",
        handleAsyncError,
        ruleSource: activeRuleSource,
        classNames: [classNames["detail"], classNames["input-field"]],
    });

    let lintDiagnostics: readonly LintDiagnostic[] = [];
    let lintGeneration = 0;
    const lintRun = createAsyncCancelScope(handleAsyncError);
    const lintSummary = document.createElement("div");
    lintSummary.style.display = "flex";
    lintSummary.style.flexDirection = "column";
    const lintControls = document.createElement("div");
    lintControls.style.display = "flex";
    lintControls.style.flexDirection = "column";
    lintControls.style.gap = "6px";
    lintControls.style.width = "100%";
    const autoFixButton = document.createElement("button");
    autoFixButton.type = "button";
    autoFixButton.className = classNames.button;
    autoFixButton.textContent = "Lintを自動修正";
    autoFixButton.addEventListener("click", () => {
        void applyAllLintFixes().catch(handleAsyncError);
    });
    lintControls.append(autoFixButton, lintSummary);

    function currentLintInput(): LintInput | undefined {
        if (!selectedDraft) return;
        return {
            fields: {
                title: selectedDraft.name,
                description: selectedDraft.description,
                note: selectedDraft.note,
            },
        };
    }

    function validateLintDiagnostics(
        diagnostics: readonly LintDiagnostic[],
        input: LintInput,
    ) {
        for (const diagnostic of diagnostics) {
            const text = input.fields[diagnostic.location];
            if (
                text === undefined ||
                !Number.isInteger(diagnostic.from) ||
                !Number.isInteger(diagnostic.to) ||
                diagnostic.from < 0 ||
                diagnostic.to < diagnostic.from ||
                diagnostic.to > text.length
            ) {
                throw new Error(
                    `Lint returned an invalid range for ${diagnostic.location}`,
                );
            }
        }
    }

    function updateLintSummary() {
        lintSummary.replaceChildren();
        lintControls.hidden = !activeLintSource || !selectedDraft;
        detailName.style.boxShadow = lintDiagnostics.some(
            (diagnostic) => diagnostic.location === "title",
        )
            ? "0 0 0 2px #e74c3c"
            : "";
        if (!activeLintSource || !selectedDraft) return;

        for (const diagnostic of lintDiagnostics) {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.flexWrap = "wrap";
            row.style.alignItems = "center";
            row.style.gap = "4px";
            row.style.padding = "4px 0";
            const message = document.createElement("button");
            message.type = "button";
            message.className = classNames.button;
            message.textContent = `${diagnostic.location} (${diagnostic.severity}): ${diagnostic.message}`;
            message.style.padding = "4px 6px";
            message.style.color = "#1f2937";
            message.style.background = "#f1f5f9";
            message.style.textAlign = "left";
            message.style.textDecoration = "underline dotted";
            message.addEventListener("click", () => {
                if (diagnostic.location === "title") {
                    detailName.focus();
                    detailName.setSelectionRange(
                        diagnostic.from,
                        diagnostic.to,
                    );
                } else {
                    const target =
                        diagnostic.location === "description"
                            ? descriptionEditor
                            : noteEditor;
                    target.selectRange(diagnostic.from, diagnostic.to);
                }
            });
            row.append(message);
            if (diagnostic.fix != null) {
                row.append(
                    createLintActionButton("自動修正", () =>
                        applyLintEdits(diagnostic.fix ?? []),
                    ),
                );
            }
            for (const suggestion of diagnostic.suggestions ?? []) {
                row.append(
                    createLintActionButton(suggestion.label, () =>
                        applyLintEdits(suggestion.edits),
                    ),
                );
            }
            lintSummary.append(row);
        }
    }

    function createLintActionButton(
        label: string,
        apply: () => void,
    ): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.className = classNames.button;
        button.textContent = label;
        button.style.padding = "4px 6px";
        button.style.color = "#1f2937";
        button.style.background = "#f1f5f9";
        button.addEventListener("click", () => {
            try {
                apply();
            } catch (reason) {
                handleAsyncError(reason);
            }
        });
        return button;
    }

    function updateLint() {
        const generation = ++lintGeneration;
        const input = currentLintInput();
        if (!activeLintSource || input == null) {
            lintRun(async () => undefined);
            lintDiagnostics = [];
            descriptionEditor.setLintDiagnostics([], applyLintEdits);
            noteEditor.setLintDiagnostics([], applyLintEdits);
            updateLintSummary();
            return;
        }
        lintDiagnostics = [];
        descriptionEditor.setLintDiagnostics([], applyLintEdits);
        noteEditor.setLintDiagnostics([], applyLintEdits);
        updateLintSummary();
        lintRun(async (signal) => {
            const diagnostics = await evaluateLint(
                activeLintSource,
                input,
                signal,
            );
            if (
                signal.aborted ||
                generation !== lintGeneration ||
                selectedDraft == null
            ) {
                return;
            }
            validateLintDiagnostics(diagnostics, input);
            lintDiagnostics = diagnostics;
            descriptionEditor.setLintDiagnostics(
                diagnostics,
                applyLintEdits,
            );
            noteEditor.setLintDiagnostics(diagnostics, applyLintEdits);
            updateLintSummary();
        });
    }

    function validateTextEdits(
        edits: readonly LintTextEdit[],
        input: LintInput,
    ) {
        if (edits.length === 0) {
            throw new Error("A Lint edit must contain at least one change");
        }
        for (let index = 0; index < edits.length; index++) {
            const edit = edits[index]!;
            const text = input.fields[edit.location];
            if (
                text === undefined ||
                !Number.isInteger(edit.from) ||
                !Number.isInteger(edit.to) ||
                edit.from < 0 ||
                edit.to < edit.from ||
                edit.to > text.length
            ) {
                throw new Error(
                    `Lint returned an invalid edit for ${edit.location}`,
                );
            }
            for (const other of edits.slice(index + 1)) {
                if (edit.location !== other.location) continue;
                if (doEditsConflict(edit, other)) {
                    throw new Error("Lint edit group contains overlapping edits");
                }
            }
        }
    }

    function doEditsConflict(
        edit: LintTextEdit,
        other: LintTextEdit,
    ): boolean {
        if (edit.from === edit.to) {
            return other.from === other.to
                ? edit.from === other.from
                : other.from <= edit.from && edit.from <= other.to;
        }
        if (other.from === other.to) {
            return edit.from <= other.from && other.from <= edit.to;
        }
        return edit.from < other.to && other.from < edit.to;
    }

    function applyLintEdits(
        edits: readonly LintTextEdit[],
        refreshLint = true,
    ) {
        const draft = selectedDraft;
        const input = currentLintInput();
        if (!draft || !input) return;
        validateTextEdits(edits, input);

        const nextFields: Record<LintLocation, string> = {
            title: draft.name,
            description: draft.description,
            note: draft.note,
        };
        for (const location of ["title", "description", "note"] as const) {
            const locationEdits = edits
                .filter((edit) => edit.location === location)
                .sort((left, right) => right.from - left.from);
            for (const edit of locationEdits) {
                const text = nextFields[location];
                nextFields[location] =
                    text.slice(0, edit.from) +
                    edit.insert +
                    text.slice(edit.to);
            }
        }

        draft.name = nextFields.title;
        draft.description = nextFields.description;
        draft.note = nextFields.note;
        detailName.value = draft.name;
        descriptionEditor.dispatchSource(draft.description);
        noteEditor.dispatchSource(draft.note);
        overlay.updateDraftTitle(draft);
        updateOpenMapLinks();
        if (refreshLint) updateLint();
        updateVirtualList();
        saveDraftChanges(draft);
        updateLint();
    }

    function editsConflict(
        first: readonly LintTextEdit[],
        second: readonly LintTextEdit[],
    ) {
        return         first.some((edit) =>
            second.some(
                (other) =>
                    edit.location === other.location &&
                    doEditsConflict(edit, other),
            ),
        );
    }

    async function applyAllLintFixes() {
        const targetDraft = selectedDraft;
        const source = activeLintSource;
        if (!source || !targetDraft) return;
        for (let iteration = 0; iteration < 10; iteration++) {
            if (selectedDraft !== targetDraft || activeLintSource !== source) {
                return;
            }
            const input = currentLintInput();
            if (!input) return;
            const diagnostics = await evaluateLint(
                source,
                input,
                new AbortController().signal,
            );
            if (selectedDraft !== targetDraft || activeLintSource !== source) {
                return;
            }
            if (
                JSON.stringify(currentLintInput()?.fields) !==
                JSON.stringify(input.fields)
            ) {
                updateLint();
                return;
            }
            validateLintDiagnostics(diagnostics, input);
            const accepted: LintTextEdit[] = [];
            const candidates = diagnostics.flatMap((diagnostic) =>
                diagnostic.fix == null ? [] : [diagnostic.fix],
            );
            for (const candidate of candidates) {
                validateTextEdits(candidate, input);
                if (editsConflict(accepted, candidate)) continue;
                accepted.push(...candidate);
            }
            if (accepted.length === 0) break;
            const previousFields = JSON.stringify(input.fields);
            applyLintEdits(accepted, false);
            if (
                JSON.stringify(currentLintInput()?.fields) === previousFields
            ) {
                break;
            }
        }
        updateLint();
    }

    const detailCoordinates = (
        <input
            type="text"
            value=""
            classList={[
                classNames["detail"],
                classNames["detail-coordinates"],
                classNames["input-field"],
            ]}
            oninput={(event) => {
                if (!selectedDraft) return;
                const textarea = event.target as HTMLTextAreaElement;
                try {
                    const newCoordinates = parseCoordinates(textarea.value);
                    if (newCoordinates.length > 0) {
                        selectedDraft.coordinates = newCoordinates as [
                            LatLng,
                            ...LatLng[],
                        ];
                        textarea.classList.remove(classNames["input-error"]);
                    } else {
                        textarea.classList.add(classNames["input-error"]);
                        return;
                    }
                } catch (e) {
                    console.error("Failed to parse coordinates:", e);
                    textarea.classList.add(classNames["input-error"]);
                    return;
                }
                overlay.updateDraftCoordinates(selectedDraft);
                updateOpenMapLinks();
                saveDraftChanges(selectedDraft);
            }}
            onfocus={(event) => (event.target as HTMLInputElement).select()}
        />
    ) as HTMLInputElement;

    const externalUrlMenu = (
        <div class={classNames["external-url-menu"]} hidden></div>
    ) as HTMLDivElement;
    externalUrlMenu.setAttribute("role", "menu");
    const externalUrlButton = (
        <button
            type="button"
            classList={[classNames.button, classNames["open-map-button"]]}
            title="設定した外部URLを開く"
            aria-label="設定した外部URLを開く"
            disabled
            onclick={() => {
                if (externalUrlMenu.childElementCount === 1) {
                    const link = externalUrlMenu.firstElementChild;
                    if (link instanceof HTMLAnchorElement) {
                        window.open(link.href, "_blank", "noopener,noreferrer");
                    }
                    return;
                }
                if (externalUrlMenu.hidden) {
                    externalUrlMenu.hidden = false;
                    externalUrlButton.setAttribute("aria-expanded", "true");
                } else {
                    closeExternalUrlMenu();
                }
            }}
        >
            ↗
        </button>
    ) as HTMLButtonElement;
    externalUrlButton.setAttribute("aria-haspopup", "menu");
    externalUrlButton.setAttribute("aria-expanded", "false");
    const externalUrlControl = (
        <div class={classNames["external-url-control"]}>
            {externalUrlButton}
            {externalUrlMenu}
        </div>
    ) as HTMLDivElement;
    const closeExternalUrlMenu = () => {
        externalUrlMenu.hidden = true;
        externalUrlButton.setAttribute("aria-expanded", "false");
    };
    document.addEventListener("pointerdown", (event) => {
        if (
            !externalUrlMenu.hidden &&
            event.target instanceof Node &&
            !externalUrlControl.contains(event.target)
        ) {
            closeExternalUrlMenu();
        }
    });
    externalUrlMenu.addEventListener("click", closeExternalUrlMenu);

    const openMapButton = (
        <a
            classList={[classNames.button, classNames["open-map-button"]]}
            target="_blank"
            rel="noopener noreferrer"
        >
            🗺️
        </a>
    ) as HTMLAnchorElement;

    const updateOpenMapLinks = () => {
        updateExternalUrlOptions();
        if (!selectedDraft) return;

        const {
            coordinates: [p],
            name: title,
        } = selectedDraft;
        openMapButton.href = getGoogleMapsUrl(p, title);
    };

    let externalUrlUpdateId = 0;
    const updateExternalUrlOptions = () => {
        const updateId = ++externalUrlUpdateId;
        externalUrlMenu.replaceChildren();
        closeExternalUrlMenu();
        externalUrlButton.disabled = !selectedDraft || !activeOpenSource;
        if (!selectedDraft || !activeOpenSource) return;

        const draft = selectedDraft;
        const [point] = draft.coordinates;
        const data: ExternalUrlData = {
            lat: point.lat,
            lng: point.lng,
            title: draft.name,
            description: draft.description,
            note: draft.note,
        };
        void (async () => {
            try {
                const options = await evaluateExternalUrls(
                    activeOpenSource,
                    data,
                    new AbortController().signal,
                );
                if (
                    updateId !== externalUrlUpdateId ||
                    selectedDraft !== draft
                ) {
                    return;
                }
                for (const option of options) {
                    const url = new URL(option.url, document.baseURI);
                    if (url.protocol !== "http:" && url.protocol !== "https:") {
                        throw new Error(
                            `Unsupported external URL protocol: ${url.protocol}`,
                        );
                    }
                    const link = (
                        <a
                            href={url.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            class={classNames["external-url-menu-item"]}
                        >
                            {option.label}
                        </a>
                    ) as HTMLAnchorElement;
                    link.setAttribute("role", "menuitem");
                    externalUrlMenu.append(link);
                }
                externalUrlButton.disabled = options.length === 0;
            } catch (error) {
                if (updateId === externalUrlUpdateId) {
                    externalUrlButton.disabled = true;
                    handleAsyncError(error);
                }
            }
        })();
    };

    const deleteButton = (
        <button
            classList={[classNames.button, classNames["delete-button"]]}
            onclick={() => {
                if (!selectedDraft) {
                    alert("削除する候補が選択されていません。");
                    return;
                }
                if (
                    confirm(`本当に「${selectedDraft.name}」を削除しますか？`)
                ) {
                    deleteSelectedDraft(selectedDraft.id);
                }
            }}
        >
            🗑️削除
        </button>
    );
    const mapButton = (
        <button
            class={classNames.button}
            onclick={() => {
                if (selectedDraft) {
                    overlay.map.setCenter(selectedDraft.coordinates[0]);
                }
            }}
        >
            🎯地図で表示
        </button>
    );

    const templateToggleButton = (
        <button
            classList={[classNames.button, classNames["template-button"]]}
            onclick={() => {
                if (!selectedDraft) return;

                if (getDraftIsTemplate(selectedDraft)) {
                    setDraftIsTemplate(selectedDraft, false);
                    saveDraftChanges(selectedDraft);
                } else {
                    const currentTemplate = allDrafts.find((d) =>
                        getDraftIsTemplate(d),
                    );
                    if (currentTemplate) {
                        setDraftIsTemplate(currentTemplate, false);
                        saveDraftChanges(currentTemplate);
                    }
                    setDraftIsTemplate(selectedDraft, true);
                    saveDraftChanges(selectedDraft);
                }
                updateVirtualList();
                updateDetailPane();
            }}
        >
            📄テンプレート
        </button>
    );

    const configView = createLocalConfigView(local);
    const configDialog = createDialog(configView.element, { title: "設定" });

    const deleteSelectedDraft = (draftId: Draft["id"]) => {
        const { apiRoot, userId } = local.getConfig();
        if (!userId || !apiRoot) {
            console.error(
                "User ID or API Root not available. Cannot delete draft.",
            );
            return;
        }

        overlay.deleteDraft(draftId);
        allDrafts = allDrafts.filter((d) => d.id !== draftId);
        filteredDrafts = filteredDrafts.filter((d) => d.id !== draftId);

        if (selectedDraft?.id === draftId) {
            selectedDraft = null;
            updateDetailPane();
        }
        updateVirtualList();

        remote.delete(
            {
                "route-id": draftId,
            },
            apiRoot,
        );
    };

    const container = (
        <div class={classNames["container"]}>
            {filterInput.element}
            <div class={classNames["list-container"]}>{virtualListElement}</div>
            <details class={classNames["detail-pane"]}>
                <summary class={classNames["detail-summary"]}>
                    {detailName}
                    <button
                        class={classNames.button}
                        onclick={() => addNewDraft()}
                    >
                        📍追加
                    </button>
                </summary>
                <div class={classNames["detail-content-wrapper"]}>
                    <div class={classNames["coordinates-container"]}>
                        {detailCoordinates}
                        {openMapButton}
                        {externalUrlControl}
                    </div>
                    {descriptionEditor.element}
                    {noteEditor.element}
                    {lintControls}
                    {deleteButton}
                    {mapButton}
                    {templateToggleButton}
                    <button
                        class={classNames.button}
                        onclick={() => {
                            configDialog.show();
                        }}
                    >
                        ⚙️設定
                    </button>
                </div>
            </details>
        </div>
    );

    const addNewDraft = () => {
        const { userId } = local.getConfig();
        if (!userId) {
            console.error("User ID not available. Cannot create draft.");
            return;
        }

        const center = overlay.map.getCenter();
        if (!center) return;

        const newDraftId = `draft-${Date.now()}-${Math.floor(
            Math.random() * 1000000,
        )}`;

        const newDraft: Draft = {
            id: newDraftId,
            type: "route",
            userId,
            name: "新しい候補",
            coordinates: [{ lat: center.lat(), lng: center.lng() }],
            description: "",
            note: "",
            data: {},
        };

        const templateDraft = allDrafts.find((d) => getDraftIsTemplate(d));

        if (templateDraft) {
            newDraft.name = applyTemplate(templateDraft.name);
            newDraft.description = applyTemplate(templateDraft.description);
            newDraft.note = applyTemplate(templateDraft.note);
            newDraft.data = structuredClone(templateDraft.data);
            setDraftIsTemplate(newDraft, false);
        }

        overlay.addDraft(newDraft);
        overlay.select(newDraft.id);
        selectedDraft = newDraft;
        updateDetailPane();
        updateVirtualList();
        dispatchCountUpdatedEvent();
        saveDraftChanges(newDraft);
    };

    const updateDetailPane = () => {
        if (selectedDraft) {
            detailName.value = selectedDraft.name;
            descriptionEditor.dispatchSource(selectedDraft.description);
            noteEditor.dispatchSource(selectedDraft.note);
            detailCoordinates.value = coordinatesToString(
                selectedDraft.coordinates,
            );
            detailCoordinates.classList.remove(classNames["input-error"]);
            mapButton.style.display = "";
            updateOpenMapLinks();
            updateLint();
            openMapButton.style.display = "";
            externalUrlControl.style.display = "";
            deleteButton.style.display = "";
            templateToggleButton.style.display = "";
            if (getDraftIsTemplate(selectedDraft)) {
                templateToggleButton.textContent = "📄テンプレート (設定済み)";
                templateToggleButton.classList.add(classNames["is-template"]);
            } else {
                templateToggleButton.textContent = "📄テンプレートに設定";
                templateToggleButton.classList.remove(
                    classNames["is-template"],
                );
            }
        } else {
            detailName.value = "";
            descriptionEditor.dispatchSource("");
            noteEditor.dispatchSource("");
            detailCoordinates.value = "";
            detailCoordinates.classList.remove(classNames["input-error"]);
            mapButton.style.display = "none";
            openMapButton.removeAttribute("href");
            openMapButton.style.display = "none";
            externalUrlUpdateId++;
            externalUrlMenu.replaceChildren();
            closeExternalUrlMenu();
            externalUrlButton.disabled = true;
            externalUrlControl.style.display = "none";
            deleteButton.style.display = "none";
            templateToggleButton.style.display = "none";
            updateLint();
        }
    };
    updateDetailPane();

    function errorToDiagnostic(e: Error): SalDiagnostic {
        let start = 0;
        let stop = 0;
        if (e instanceof SalEvaluationError && e.range) {
            start = e.range.start.index;
            stop = e.range.stop.index;
        }
        return {
            start,
            stop,
            message: e.message,
            severity: "error",
            source: "evaluator",
        };
    }
    const applyFilterCancelScope = createAsyncCancelScope(handleAsyncError);
    const requestFilterUpdate = () =>
        applyFilterCancelScope(async (signal) => {
            await sleep(500, { signal });
            const queryId = getSelectedSourceId() ?? "";
            const query = getSelectedSource() ?? "";

            events.dispatchEvent(
                createTypedCustomEvent("filter-start", undefined),
            );
            const diagnostics: SalDiagnostic[] = [];
            try {
                filteredDrafts = await filterDrafts(
                    records,
                    allDrafts,
                    geo,
                    query,
                    signal,
                    (message, start, stop) => {
                        diagnostics.push({
                            severity: "error",
                            start,
                            stop,
                            message,
                            source: "parser",
                        });
                    },
                );
                editor.setErrors(queryId, diagnostics);
                filterInput.setErrors(diagnostics);
            } catch (e) {
                if (e instanceof Error) {
                    const errors = [
                        ...diagnostics,
                        errorToDiagnostic(e),
                    ];
                    editor.setErrors(queryId, errors);
                    filterInput.setErrors(errors);
                }
                throw e;
            } finally {
                events.dispatchEvent(
                    createTypedCustomEvent("filter-end", undefined),
                );
            }
            dispatchCountUpdatedEvent();
            updateVirtualList();
        });

    const updateVirtualList = () => {
        const virtualElements: VirtualElements = {
            itemHeight: 40,
            count: filteredDrafts.length,
            get: (index: number) => {
                const draft = filteredDrafts[index];
                if (!draft) return undefined;

                const item = document.createElement("div");
                item.className = classNames["item"];
                if (selectedDraft && selectedDraft.id === draft.id) {
                    item.classList.add(classNames["selected"]);
                }

                const nameDiv = document.createElement("div");
                nameDiv.className = classNames["item-name"];
                nameDiv.textContent = draft.name;

                const noteDiv = document.createElement("div");
                noteDiv.className = classNames["item-note"];
                noteDiv.textContent = draft.note;

                item.append(nameDiv, noteDiv);

                const onClick = () => {
                    overlay.select(draft.id);
                    updateDetailPane();
                    updateVirtualList();
                };
                const onDblclick = () => {
                    overlay.map.setCenter(draft.coordinates[0]);
                };

                // firefox で click と dblclick が干渉するので対策
                let clickTimer: ReturnType<typeof setTimeout> | null = null;
                item.addEventListener("click", () => {
                    clickTimer = setTimeout(() => {
                        selectedDraft = draft;
                        onClick();
                        clickTimer = null;
                    }, 0);
                });
                item.addEventListener("dblclick", () => {
                    if (clickTimer !== null) clearTimeout(clickTimer);
                    clickTimer = null;
                    onDblclick();
                });
                return item;
            },
        };
        setVirtualListItems(virtualElements);
    };
    updateVirtualList();

    return {
        events,
        element: container,
        setDrafts(newDrafts: readonly Draft[]) {
            allDrafts.splice(0, allDrafts.length, ...newDrafts);
            requestFilterUpdate();
            if (
                selectedDraft &&
                !newDrafts.some((d) => d.id === selectedDraft?.id)
            ) {
                selectedDraft = null;
                updateDetailPane();
            }
        },
    };
}
