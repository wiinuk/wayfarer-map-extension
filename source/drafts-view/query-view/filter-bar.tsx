import { styleSetter } from "../../dom-extensions";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../../typed-event-target";
import classNames, { cssText } from "./filter-bar.module.css";

const setStyle = styleSetter(cssText);

export function createFilterBar({ value: initialValue }: { value: string }) {
    setStyle();

    const events = createTypedEventTarget<{
        "input-changed": undefined;
        "click-list-button": undefined;
        "click-edit-button": undefined;
    }>();

    const input = (
        <input
            type="text"
            oninput={onInput}
            classList={[classNames.input]}
            placeholder="🔍キーワードで絞り込み…"
        />
    ) as HTMLInputElement;

    const clearButton = (
        <button
            classList={[classNames["clear-button"], classNames.hidden]}
            onclick={onClickClear}
            aria-label="検索ワードを削除"
        >
            ✕
        </button>
    ) as HTMLButtonElement;

    const multiLineIndicator = (
        <span
            classList={[classNames["multi-line-indicator"], classNames.hidden]}
        >
            ...
        </span>
    ) as HTMLSpanElement;

    const element = (
        <div classList={[classNames.wrapper]}>
            {input}
            {clearButton}
            {multiLineIndicator}
            <div class={classNames.buttons}>
                <button
                    class={classNames.button}
                    onclick={() => {
                        events.dispatchEvent(
                            createTypedCustomEvent(
                                "click-list-button",
                                undefined,
                            ),
                        );
                    }}
                    aria-label="検索式一覧"
                >
                    📂
                </button>
                <button
                    class={classNames.button}
                    onclick={() => {
                        events.dispatchEvent(
                            createTypedCustomEvent(
                                "click-edit-button",
                                undefined,
                            ),
                        );
                    }}
                    aria-label="検索式を編集"
                >
                    ✏
                </button>
            </div>
        </div>
    );

    let value = "";
    function getValue() {
        const index = value.indexOf("\n");
        if (index < 0) return input.value;
        return input.value + "\n" + value.slice(index + 1);
    }
    function setValue(newValue: string) {
        value = newValue;
        const isMultiLine = newValue.includes("\n");
        if (isMultiLine) {
            multiLineIndicator.classList.remove(classNames.hidden);
        } else {
            multiLineIndicator.classList.add(classNames.hidden);
        }
        input.value = newValue.split("\n")[0] ?? "";
        updateClearButtonVisibility();
    }

    function updateClearButtonVisibility() {
        const isMultiLine = value.includes("\n");
        const hasValue = input.value.length > 0;
        if (!isMultiLine && hasValue) {
            clearButton.classList.remove(classNames.hidden);
        } else {
            clearButton.classList.add(classNames.hidden);
        }
    }

    function onInput() {
        events.dispatchEvent(
            createTypedCustomEvent("input-changed", undefined),
        );
        updateClearButtonVisibility();
    }

    function onClickClear() {
        setValue("");
        input.focus();
        events.dispatchEvent(
            createTypedCustomEvent("input-changed", undefined),
        );
    }

    setValue(initialValue);

    return { element, events, getValue, setValue };
}
