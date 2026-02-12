import classNames, { cssText } from "./source-list.module.css";
import { createVirtualList } from "../virtual-list";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../../typed-event-target";
import type { SourcesWithSelection } from "../draft-list";
import { styleSetter } from "../../dom-extensions";

const setStyle = styleSetter(cssText);
export function createSourceList({
    initialList,
}: {
    initialList: SourcesWithSelection;
}) {
    setStyle();

    const events = createTypedEventTarget<{
        select: number;
        delete: number;
        add: undefined;
    }>();
    const list = createVirtualList();
    const element = (
        <div class={classNames.wrapper}>
            {list.element}
            <button
                class={classNames["add-button"]}
                onclick={() =>
                    events.dispatchEvent(
                        createTypedCustomEvent("add", undefined),
                    )
                }
            >
                ＋ 項目を追加
            </button>
        </div>
    );

    function createListItem(sources: SourcesWithSelection, index: number) {
        const contents = sources.sources[index]?.contents;
        if (contents == null) return;

        const classList = [classNames.item];
        if (sources.selectedIndex === index) {
            classList.push(classNames.active);
        }

        return (
            <div
                classList={classList}
                onclick={() => {
                    events.dispatchEvent(
                        createTypedCustomEvent("select", index),
                    );
                }}
            >
                <span class={classNames["item-label"]}>
                    {contents === "" ? "<empty>" : contents}
                </span>
                <button
                    class={classNames["delete-button"]}
                    onclick={(e) => {
                        events.dispatchEvent(
                            createTypedCustomEvent("delete", index),
                        );
                        e.stopPropagation();
                    }}
                >
                    削除
                </button>
            </div>
        );
    }
    function setSources(sources: SourcesWithSelection) {
        list.setItems({
            itemHeight: 52,
            count: sources.sources.length,
            get(index) {
                return createListItem(sources, index);
            },
        });
    }
    setSources(initialList);

    return {
        element,
        events,
        setSources,
    };
}
