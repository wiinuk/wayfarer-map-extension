import { styleSetter } from "../../dom-extensions";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../../typed-event-target";
import {
    createInlineQueryEditor,
    type SalDiagnostic,
} from "./editor";
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
        <div classList={[classNames.input]} />
    ) as HTMLDivElement;

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

    let value = initialValue;
    const queryEditor = createInlineQueryEditor({
        parent: input,
        initialText: initialValue.split("\n", 1)[0] ?? "",
        onInput,
    });

    function getValue() {
        const index = value.indexOf("\n");
        const firstLine = queryEditor.view.state.doc.toString();
        if (index < 0) return firstLine;
        return firstLine + "\n" + value.slice(index + 1);
    }
    function setValue(newValue: string) {
        value = newValue;
        const isMultiLine = newValue.includes("\n");
        if (isMultiLine) {
            multiLineIndicator.classList.remove(classNames.hidden);
        } else {
            multiLineIndicator.classList.add(classNames.hidden);
        }
        queryEditor.setValue(newValue);
        updateErrorState([]);
        updateClearButtonVisibility();
    }

    function updateClearButtonVisibility() {
        const isMultiLine = value.includes("\n");
        const hasValue = queryEditor.view.state.doc.length > 0;
        if (!isMultiLine && hasValue) {
            clearButton.classList.remove(classNames.hidden);
        } else {
            clearButton.classList.add(classNames.hidden);
        }
    }

    function onInput() {
        updateErrorState([]);
        events.dispatchEvent(
            createTypedCustomEvent("input-changed", undefined),
        );
        updateClearButtonVisibility();
    }

    function onClickClear() {
        setValue("");
        queryEditor.view.focus();
        events.dispatchEvent(
            createTypedCustomEvent("input-changed", undefined),
        );
    }

    function setErrors(errors: readonly SalDiagnostic[]) {
        queryEditor.setErrors(errors);
        updateErrorState(errors);
    }

    function updateErrorState(errors: readonly SalDiagnostic[]) {
        const hasErrors = errors.length > 0;
        input.classList.toggle(classNames.error, hasErrors);
        input.setAttribute("aria-invalid", String(hasErrors));
        input.title = errors.map((error) => error.message).join("\n");
    }

    setValue(initialValue);

    return { element, events, getValue, setValue, setErrors };
}
