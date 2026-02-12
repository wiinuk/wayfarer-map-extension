import { styleSetter } from "../dom-extensions";
import {
    createTypedEventTarget,
    createTypedCustomEvent,
} from "../typed-event-target";
import classNames, { cssText } from "./item-input.module.css";
const setStyle = styleSetter(cssText);

export type Json = null | number | string | Json[] | { [k: string]: Json };
export function createJsonItemInput(label: string) {
    setStyle();

    const events = createTypedEventTarget<{ changed: undefined }>();

    const dispatchChange = () =>
        events.dispatchEvent(createTypedCustomEvent("changed", undefined));

    const textarea = (
        <textarea
            class={classNames["textarea"]}
            oninput={dispatchChange}
        ></textarea>
    ) as HTMLTextAreaElement;

    const enabledCheckbox = (
        <input
            type="checkbox"
            class={classNames["checkbox"]}
            onchange={() => {
                const isChecked = enabledCheckbox.checked;
                textarea.disabled = !isChecked;
                inputContainer.style.display = isChecked ? "" : "none";
                dispatchChange();
            }}
        />
    ) as HTMLInputElement;

    const inputContainer = (
        <div class={classNames["form-group"]}>
            <label class={classNames["label"]}>{textarea}</label>
        </div>
    ) as HTMLDivElement;

    const element = (
        <>
            <div class={classNames["form-group"]}>
                <label class={classNames["label"]}>
                    {enabledCheckbox}
                    <span>{label}</span>
                </label>
            </div>
            {inputContainer}
        </>
    );
    function setValue(value: Json | undefined) {
        const hasValue = value !== undefined;
        enabledCheckbox.checked = hasValue;
        textarea.disabled = !hasValue;
        inputContainer.style.display = hasValue ? "" : "none";
        textarea.value = hasValue ? JSON.stringify(value, null, 2) : "";
    }
    function getValue() {
        if (enabledCheckbox.checked) {
            try {
                const parsedJson: Json = JSON.parse(textarea.value);
                return parsedJson;
            } catch {
                throw new Error("Invalid JSON. Please check the syntax.");
            }
        }
    }

    return {
        element,
        events,
        setValue,
        getValue,
    };
}
