import classNames, { cssText } from "./draft-list.module.css";
import { createVirtualList, type VirtualElements } from "./virtual-list";
import type { DraftsOverlay } from "../drafts-overlay";
import type { LatLng } from "../s2";
import type { Draft, Remote } from "../remote";
import type { LocalConfigAccessor } from "../local-config";
import { coordinatesToString, parseCoordinates } from "../geometry";

interface DraftListOptions {
    readonly overlay: DraftsOverlay;
    readonly remote: Remote;
    readonly local: LocalConfigAccessor;
    readonly onDraftSelected?: (draft: Draft | null) => void;
}

export function createDraftList({
    overlay,
    remote,
    local,
    onDraftSelected,
}: DraftListOptions) {
    const allDrafts: Draft[] = Array.from(overlay.drafts.values()).map(
        (view) => view.draft,
    );
    let filteredDrafts: Draft[] = [...allDrafts];
    let searchTerm: string = "";
    let selectedDraft: Draft | null = null;

    const saveDraftChanges = (draft: Draft) => {
        const { apiRoot, userId } = local.getConfig();
        if (apiRoot && userId) {
            remote.set(
                {
                    type: "route",
                    "user-id": userId,
                    "route-id": draft.id,
                    "route-name": draft.name,
                    coordinates: coordinatesToString(draft.coordinates),
                    description: draft.description,
                    note: draft.note,
                    data: JSON.stringify({ kind: "spot" }),
                },
                apiRoot,
            );
        }
    };

    const listContainer = <div class={classNames["list-container"]}></div>;
    const {
        element: virtualListElement,
        setItems: setVirtualListItems,
        cssText: virtualListCssText,
    } = createVirtualList();
    listContainer.append(virtualListElement);

    const searchInput = (
        <input
            type="search"
            class={classNames["search-input"]}
            placeholder="Search drafts..."
        />
    ) as HTMLInputElement;

    const detailName = (
        <input type="text" class={classNames["detail-name"]} value="" />
    ) as HTMLInputElement;

    detailName.addEventListener("input", (event: Event) => {
        if (!selectedDraft) return;
        selectedDraft.name = (event.target as HTMLInputElement).value;
        overlay.updateDraftTitle(selectedDraft);
        saveDraftChanges(selectedDraft);
    });

    const detailDescription = (
        <textarea class={classNames["detail-description"]} value=""></textarea>
    ) as HTMLTextAreaElement;

    detailDescription.addEventListener("input", (event: Event) => {
        if (!selectedDraft) return;
        selectedDraft.description = (event.target as HTMLTextAreaElement).value;
        saveDraftChanges(selectedDraft);
    });
    const detailNote = (
        <textarea class={classNames["detail-note"]} value=""></textarea>
    ) as HTMLTextAreaElement;
    detailNote.addEventListener("input", (event: Event) => {
        if (!selectedDraft) return;
        selectedDraft.note = (event.target as HTMLTextAreaElement).value;
        saveDraftChanges(selectedDraft);
    });
    const detailCoordinates = (
        <input type="text" class={classNames["detail-coordinates"]} value="" />
    ) as HTMLInputElement;

    detailCoordinates.addEventListener("input", (event: Event) => {
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
    });
    const mapButton = (
        <button class={classNames["map-button"]}>🎯地図で表示</button>
    );

    const detailPane = (
        <details class={classNames["detail-pane"]} open={true}>
            <summary class={classNames["detail-summary"]}>{detailName}</summary>
            <div class={classNames["detail-content-wrapper"]}>
                {detailDescription}
                {detailNote}
                {detailCoordinates}
                {mapButton}
            </div>
        </details>
    );
    const container = (
        <div class={classNames["container"]}>
            {searchInput}
            {listContainer}
            {detailPane}
        </div>
    );

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
        } else {
            detailName.textContent = "No draft selected";
            detailDescription.value = "";
            detailNote.value = "";
            detailCoordinates.value = "";
            detailCoordinates.classList.remove(classNames["input-error"]);
            mapButton.style.display = "none";
        }
    };
    updateDetailPane();

    const applyFilter = () => {
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        filteredDrafts = allDrafts.filter(
            (draft) =>
                draft.name.toLowerCase().includes(lowerCaseSearchTerm) ||
                draft.description.toLowerCase().includes(lowerCaseSearchTerm),
        );
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

                item.addEventListener("click", () => {
                    selectedDraft = draft;
                    updateDetailPane();
                    onDraftSelected?.(draft);
                    updateVirtualList();
                });
                item.addEventListener("dblclick", () => {
                    if (draft) {
                        overlay.map.setCenter(draft.coordinates[0]);
                    }
                });
                return item;
            },
        };
        setVirtualListItems(virtualElements);
    };
    updateVirtualList();

    searchInput.addEventListener("input", () => {
        searchTerm = searchInput.value;
        applyFilter();
    });

    mapButton.addEventListener("click", () => {
        if (selectedDraft) {
            overlay.map.setCenter(selectedDraft.coordinates[0]);
        }
    });

    return {
        element: container,
        cssText: cssText + "\n" + virtualListCssText,
        updateDrafts: (newDrafts: readonly Draft[]) => {
            allDrafts.splice(0, allDrafts.length, ...newDrafts);
            applyFilter();
            if (
                selectedDraft &&
                !newDrafts.some((d) => d.id === selectedDraft?.id)
            ) {
                selectedDraft = null;
                updateDetailPane();
                onDraftSelected?.(null);
            }
        },
    };
}
