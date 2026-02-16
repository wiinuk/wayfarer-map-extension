import { styleSetter } from "../dom-extensions";
import classNames, { cssText } from "./drafts-dialog-title.module.css";
import { createIndicator } from "./indicator";
const setStyle = styleSetter(cssText);

export function createDraftsDialogTitle({ title }: { title: string }) {
    setStyle();
    const mainTitleElement = (
        <div class={classNames["main-title"]}>{title}</div>
    );
    const countsElement = <div class={classNames["counts-element"]}></div>;
    const indicator = createIndicator();
    const element = (
        <div class={classNames.container}>
            {mainTitleElement}
            {countsElement}
            {indicator.element}
        </div>
    );
    let busyCount = 0;
    let currentIsBusy: boolean | undefined;
    function changeIsBusy() {
        const isBusy = 0 < busyCount;
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
                countsElement.innerText = `${filteredCount}/${totalCount}件`;
            } else {
                countsElement.innerText = `${totalCount}件`;
            }
        },
        pushIsBusy() {
            busyCount++;
            changeIsBusy();
        },
        popIsBusy() {
            busyCount--;
            changeIsBusy();
        },
    };
}
