import {
    createTypedCustomEvent,
    createTypedEventTarget,
} from "../../typed-event-target";
import classNames, { cssText } from "./filter-bar.module.css";

export function createFilterBar() {
    const events = createTypedEventTarget<{
        "input-changed": undefined;
        "click-list-button": undefined;
        "click-edit-button": undefined;
    }>();

    const input = (
        <input
            type="text"
            oninput={() =>
                events.dispatchEvent(
                    createTypedCustomEvent("input-changed", undefined),
                )
            }
            classList={[classNames.input]}
            placeholder="🔍キーワードで絞り込み…"
        />
    ) as HTMLInputElement;

    const element = (
        <div classList={[classNames.wrapper]}>
            {input}
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
    function getValue() {
        return input.value;
    }
    return { element, cssText, events, getValue };
}
