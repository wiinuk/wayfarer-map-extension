import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../typed-event-target";
import classNames, { cssText } from "./item-input.module.css";

interface OptionalStringConfigEventMap {
    changed: undefined;
}
export function createStringItemInput(label: string) {
    const events = createTypedEventTarget<OptionalStringConfigEventMap>();

    const dispatchChanged = () =>
        events.dispatchEvent(createTypedCustomEvent("changed", undefined));

    const input = (
        <input
            type="text"
            class={classNames["input"]}
            oninput={dispatchChanged}
        />
    ) as HTMLInputElement;

    const enabledCheckbox = (
        <input
            type="checkbox"
            class={classNames["checkbox"]}
            onchange={() => {
                const isChecked = enabledCheckbox.checked;
                input.disabled = !isChecked;
                inputContainer.style.display = isChecked ? "" : "none";
                dispatchChanged();
            }}
        />
    ) as HTMLInputElement;

    const inputContainer = (
        <div class={classNames["form-group"]}>
            <label class={classNames["label"]}>{input}</label>
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

    function setValue(value: string | undefined) {
        const hasUserId = value !== undefined;
        enabledCheckbox.checked = hasUserId;
        input.disabled = !hasUserId;
        inputContainer.style.display = hasUserId ? "" : "none";
        input.value = hasUserId ? (value ?? "") : "";
    }
    function getValue() {
        if (enabledCheckbox.checked) {
            return input.value;
        }
    }
    return {
        element,
        cssText,
        events,
        setValue,
        getValue,
    };
}
