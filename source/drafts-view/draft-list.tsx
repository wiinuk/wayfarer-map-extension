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
import { createEditor } from "./query-view/editor";
import type { PoiRecords } from "../poi-records";

interface DraftListOptions {
    readonly overlay: DraftsOverlay;
    readonly remote: Remote;
    readonly records: PoiRecords;
    readonly local: LocalConfigAccessor;
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

function openGoogleMaps({ lat, lng }: LatLng, title: string) {
    const url = isAndroid()
        ? // &z=${zoom}
          `intent://0,0?q=${lat},${lng}%20(${encodeURIComponent(title)})#Intent;scheme=geo;package=com.google.android.apps.maps;end`
        : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    window.open(url, "_blank");
}

const setStyle = styleSetter(cssText);
export function createDraftList({
    overlay,
    remote,
    records,
    local,
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

    const sourceList = createSourceList({ initialList: currentSources });
    const sourceListDialog = createDialog(sourceList.element, {
        title: "検索一覧",
    });

    const editor = createEditor({ initialText: getSelectedSource() ?? "" });
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
        setSelectedSourceAndNotify(value);
    });
    function setCurrentSourcesAndNotify(newSources: typeof currentSources) {
        currentSources = newSources;
        sourceList.setSources(currentSources);
        const selectedSource = getSelectedSource() ?? "";

        // 選択中のソースが更新されたかもしれないので処理
        filterInput.setValue(selectedSource);
        requestFilterUpdate();

        editor.setSource(selectedSource);
        local.setConfig({ ...local.getConfig(), sources: currentSources });
    }
    function getSelectedSource() {
        return currentSources.sources[currentSources.selectedIndex ?? -1]
            ?.contents;
    }
    function setSelectedSourceAndNotify(newContents: string) {
        const index = currentSources.selectedIndex ?? -1;
        const source = currentSources.sources[index];
        if (source == null) return;

        const sources = toSpliced(currentSources.sources, index, 1, {
            ...source,
            contents: newContents,
        }) as QuerySource[] as [QuerySource, ...QuerySource[]]; // 削除して追加するので元と同じ

        setCurrentSourcesAndNotify({ ...currentSources, sources });
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
                updateVirtualList();
                saveDraftChanges(selectedDraft);
            }}
        />
    ) as HTMLInputElement;

    const detailDescription = (
        <textarea
            value=""
            classList={[
                classNames["detail-description"],
                classNames["input-field"],
            ]}
            oninput={(event: Event) => {
                if (!selectedDraft) return;
                selectedDraft.description = (
                    event.target as HTMLTextAreaElement
                ).value;
                saveDraftChanges(selectedDraft);
            }}
        ></textarea>
    ) as HTMLTextAreaElement;

    const detailNote = (
        <textarea
            classList={[classNames["detail-note"], classNames["input-field"]]}
            value=""
            oninput={(event) => {
                if (!selectedDraft) return;
                selectedDraft.note = (
                    event.target as HTMLTextAreaElement
                ).value;
                saveDraftChanges(selectedDraft);
            }}
        ></textarea>
    ) as HTMLTextAreaElement;

    const detailCoordinates = (
        <input
            type="text"
            value=""
            classList={[
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
                saveDraftChanges(selectedDraft);
            }}
            onfocus={(event) => (event.target as HTMLInputElement).select()}
        />
    ) as HTMLInputElement;

    const openMapButton = (
        <button
            class={classNames["open-map-button"]}
            onclick={() => {
                if (selectedDraft) {
                    const coord = selectedDraft.coordinates[0];
                    openGoogleMaps(coord, selectedDraft.name);
                }
            }}
        >
            🗺️
        </button>
    ) as HTMLButtonElement;

    const deleteButton = (
        <button
            class={classNames["delete-button"]}
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
            class={classNames["map-button"]}
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
            class={classNames["template-button"]}
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
            <details class={classNames["detail-pane"]} open={true}>
                <summary class={classNames["detail-summary"]}>
                    {detailName}
                </summary>
                <div class={classNames["detail-content-wrapper"]}>
                    {detailDescription}
                    {detailNote}
                    <div class={classNames["coordinates-container"]}>
                        {detailCoordinates}
                        {openMapButton}
                    </div>
                    <button
                        class={classNames["create-button"]}
                        onclick={() => addNewDraft()}
                    >
                        📍新規作成
                    </button>
                    {deleteButton}
                    {mapButton}
                    {templateToggleButton}
                    <button
                        class={classNames["config-button"]}
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
            detailDescription.value = selectedDraft.description;
            detailNote.value = selectedDraft.note;
            detailCoordinates.value = coordinatesToString(
                selectedDraft.coordinates,
            );
            detailCoordinates.classList.remove(classNames["input-error"]);
            mapButton.style.display = "";
            openMapButton.style.display = "";
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
            detailDescription.value = "";
            detailNote.value = "";
            detailCoordinates.value = "";
            detailCoordinates.classList.remove(classNames["input-error"]);
            mapButton.style.display = "none";
            openMapButton.style.display = "none";
            deleteButton.style.display = "none";
            templateToggleButton.style.display = "none";
        }
    };
    updateDetailPane();

    const applyFilterCancelScope = createAsyncCancelScope(handleAsyncError);
    const requestFilterUpdate = () =>
        applyFilterCancelScope(async (signal) => {
            await sleep(500, { signal });
            const query = getSelectedSource() ?? "";

            events.dispatchEvent(
                createTypedCustomEvent("filter-start", undefined),
            );
            try {
                filteredDrafts = await filterDrafts(
                    records,
                    allDrafts,
                    query,
                    signal,
                );
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
