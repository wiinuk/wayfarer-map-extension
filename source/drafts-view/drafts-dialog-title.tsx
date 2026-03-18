import { styleSetter } from "../dom-extensions";
import classNames, { cssText } from "./drafts-dialog-title.module.css";
import { createIndicator } from "./indicator";
const setStyle = styleSetter(cssText);

export function createDraftsDialogTitle({ title }: { title: string }) {
    setStyle();
    const mainTitle = <div class={classNames["main-title"]}>{title}</div>;
    const countLabel = <div class={classNames["count-label"]}></div>;
    const indicator = createIndicator();
    const element = (
        <div class={classNames.container}>
            {mainTitle}
            {countLabel}
            {indicator.element}
        </div>
    );
    const taskIds = new Set<unknown>();
    let currentIsBusy: boolean | undefined;
    function updateIndicator() {
        const isBusy = 0 < taskIds.size;
        if (currentIsBusy !== isBusy) {
            if (isBusy) {
                indicator.start();
            } else {
                indicator.stop();
            }
            currentIsBusy = isBusy;
        }
    }
    return {
        element,
        setCounts({
            totalCount,
            filteredCount,
        }: {
            totalCount: number;
            filteredCount: number;
        }) {
            if (filteredCount !== totalCount) {
                countLabel.innerText = `${filteredCount}/${totalCount}件`;
            } else {
                countLabel.innerText = `${totalCount}件`;
            }
        },
        markAsBusy(key: unknown) {
            taskIds.add(key);
            updateIndicator();
        },
        remarkAsBusy(key: unknown) {
            taskIds.delete(key);
            updateIndicator();
        },
    };
}
