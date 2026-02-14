import { styleSetter } from "../../dom-extensions";
import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../../typed-event-target";
import classNames, { cssText } from "./editor.module.css";

const setStyle = styleSetter(cssText);

export function createEditor({ initialText }: { initialText: string }) {
    setStyle();

    const events = createTypedEventTarget<{ input: string }>();
    const textarea = (
        <textarea
            class={classNames.textarea}
            oninput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                events.dispatchEvent(
                    createTypedCustomEvent("input", target.value),
                );
            }}
        >
            {initialText}
        </textarea>
    ) as HTMLTextAreaElement;

    const element = <div class={classNames.container}>{textarea}</div>;

    function setSource(value: string) {
        textarea.value = value;
    }
    return {
        element,
        events,
        setSource,
    };
}
