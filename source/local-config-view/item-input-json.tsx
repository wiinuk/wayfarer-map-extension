import {
    createTypedEventTarget,
    createTypedCustomEvent,
} from "../typed-event-target";
import classNames, { cssText } from "./item-input.module.css";

export type Json = null | number | string | Json[] | { [k: string]: Json };
export function createJsonItemInput(label: string) {
    const events = createTypedEventTarget<{ changed: undefined }>();

    const textarea = (
        <textarea class={classNames["textarea"]}></textarea>
    ) as HTMLTextAreaElement;

    const enabledCheckbox = (
        <input type="checkbox" class={classNames["checkbox"]} />
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
    const onChange = () =>
        events.dispatchEvent(createTypedCustomEvent("changed", undefined));
    enabledCheckbox.addEventListener("change", () => {
        const isChecked = enabledCheckbox.checked;
        textarea.disabled = !isChecked;
        inputContainer.style.display = isChecked ? "" : "none";
        onChange();
    });
    textarea.addEventListener("input", onChange);

    return {
        element,
        cssText,
        events,
        setValue,
        getValue,
    };
}
