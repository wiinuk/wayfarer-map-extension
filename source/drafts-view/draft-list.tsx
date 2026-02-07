import classNames, { cssText } from "./draft-list.module.css";
import { createVirtualList, type VirtualElements } from "./virtual-list";
import type { DraftsOverlay } from "../drafts-overlay";
import type { LatLng } from "../s2";
import type { Draft } from "../remote";

interface DraftListOptions {
    readonly overlay: DraftsOverlay;
    readonly onDraftSelected?: (draft: Draft | null) => void;
}

function latLngToString(latLng: LatLng): string {
    return `${latLng.lat.toFixed(6)}, ${latLng.lng.toFixed(6)}`;
}

export function createDraftList({
    overlay,
    onDraftSelected,
}: DraftListOptions) {
    const allDrafts: Draft[] = Array.from(overlay.drafts.values()).map(
        (view) => view.draft,
    );
    let filteredDrafts: Draft[] = [...allDrafts];
    let searchTerm: string = "";
    let selectedDraft: Draft | null = null;

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

    const detailName = <div class={classNames["detail-name"]}></div>;
    const detailDescription = (
        <div class={classNames["detail-description"]}></div>
    );
    const detailNote = <div class={classNames["detail-note"]}></div>;
    const detailCoordinates = (
        <div class={classNames["detail-coordinates"]}></div>
    );
    const mapButton = (
        <button class={classNames["map-button"]}>🎯地図で表示</button>
    );

    const detailPane = (
        <details class={classNames["detail-pane"]} open={true}>
            <summary class={classNames["detail-summary"]}>{detailName}</summary>
            {detailDescription}
            {detailNote}
            {detailCoordinates}
            {mapButton}
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
            detailName.textContent = selectedDraft.name;
            detailDescription.textContent = selectedDraft.description;
            detailNote.textContent = selectedDraft.note;
            detailCoordinates.textContent = latLngToString(
                selectedDraft.coordinates[0],
            );
            mapButton.style.display = "";
        } else {
            detailName.textContent = "No draft selected";
            detailDescription.textContent = "";
            detailNote.textContent = "";
            detailCoordinates.textContent = "";
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

                const item = document.createElement("li");
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

                const contentDiv = document.createElement("div");
                contentDiv.className = classNames["item-content"];
                contentDiv.append(nameDiv, noteDiv);
                item.append(contentDiv);

                item.addEventListener("click", () => {
                    selectedDraft = draft;
                    updateDetailPane();
                    onDraftSelected?.(draft);
                    updateVirtualList(); // Re-render to highlight new selection
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
