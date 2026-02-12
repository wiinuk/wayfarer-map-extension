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

function hasTermInString(text: string, term: string) {
    return text.toLowerCase().includes(term);
}
function hasTermInDraft({ name, description, note }: Draft, term: string) {
    return (
        hasTermInString(name, term) ||
        hasTermInString(description, term) ||
        hasTermInString(note, term)
    );
}

interface DraftListOptions {
    readonly overlay: DraftsOverlay;
    readonly remote: Remote;
    readonly local: LocalConfigAccessor;
}
interface DraftListEventMap {
    "count-changed": {
        totalCount: number;
        filteredCount: number;
    };
}

const setStyle = styleSetter(cssText);
export function createDraftList({ overlay, remote, local }: DraftListOptions) {
setStyle();

    const events = createTypedEventTarget<DraftListEventMap>();
    let allDrafts: Draft[] = Array.from(overlay.drafts.values()).map(
        (view) => view.draft,
    );
    let filteredDrafts: Draft[] = [...allDrafts];
    let searchTerm: string = "";
    let selectedDraft: Draft | null = null;

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

    const filterInput = createFilterBar();

    filterInput.events.addEventListener("input-changed", () => {
        searchTerm = filterInput.getValue();
        applyFilter();
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
        />
    ) as HTMLInputElement;

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
                    {detailCoordinates}
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
            deleteButton.style.display = "none";
            templateToggleButton.style.display = "none";
        }
    };
    updateDetailPane();

    const applyFilter = () => {
        const searchAndTerms = searchTerm.toLowerCase().match(/[^ ]+/g) ?? [""];
        filteredDrafts = allDrafts.filter((draft) => {
            for (const term of searchAndTerms) {
                if (!hasTermInDraft(draft, term)) return false;
            }
            return true;
        });
        dispatchCountUpdatedEvent();
        updateVirtualList();
    };

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
                    if (draft) {
                        overlay.map.setCenter(draft.coordinates[0]);
                    }
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
            applyFilter();
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
