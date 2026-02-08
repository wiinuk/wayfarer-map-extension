import classNames, { cssText } from "./drafts-dialog-title.module.css";
import { createIndicator } from "./indicator";

export function createDraftsDialogTitle({ title }: { title: string }) {
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
    let currentSaving: boolean | undefined;
    return {
        element,
        cssText: cssText + "\n" + indicator.cssText,
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
        setIsSaving(isSaving: boolean) {
            if (currentSaving !== isSaving) {
                if (isSaving) {
                    indicator.start();
                } else {
                    indicator.stop();
                }
                currentSaving = isSaving;
            }
        },
    };
}
