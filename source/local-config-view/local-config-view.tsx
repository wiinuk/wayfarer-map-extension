import classNames, { cssText } from "./local-config-view.module.css";
import {
    ConfigSchema,
    type LocalConfigAccessor,
    type Config,
} from "../local-config";
import {
    createTypedEventTarget,
    createTypedCustomEvent,
} from "../typed-event-target";
import { ZodError } from "zod";

export interface LocalConfigViewEventMap {
    "config-saved": Config;
    "config-save-error": ZodError | Error;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<F extends (this: unknown, ...args: any[]) => any>(
    f: F,
    ms: number,
) {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;

    const debounced = (...args: Parameters<F>): void => {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }

        timeout = setTimeout(() => {
            timeout = undefined;
            f(...args);
        }, ms);
    };

    const cancel = () => {
        if (timeout !== undefined) {
            clearTimeout(timeout);
            timeout = undefined;
        }
    };

    return {
        debounced,
        cancel,
    };
}

export function createLocalConfigView(configAccessor: LocalConfigAccessor) {
    const events = createTypedEventTarget<LocalConfigViewEventMap>();

    const userIdInput = (
        <input type="text" class={classNames["input"]} />
    ) as HTMLInputElement;

    const apiRootInput = (
        <input type="text" class={classNames["input"]} />
    ) as HTMLInputElement;

    const dictionariesTextarea = (
        <textarea class={classNames["textarea"]}></textarea>
    ) as HTMLTextAreaElement;

    const statusMessageElement = (
        <div class={classNames["status-message"]}>Loading configuration...</div>
    ) as HTMLDivElement;

    const element = (
        <div class={classNames["container"]}>
            <div class={classNames["form-scroll"]}>
                <div class={classNames["form-group"]}>
                    <label class={classNames["label"]}>
                        User ID
                        {userIdInput}
                    </label>
                </div>

                <div class={classNames["form-group"]}>
                    <label class={classNames["label"]}>
                        API Root URL
                        {apiRootInput}
                    </label>
                </div>

                <div class={classNames["form-group"]}>
                    <label class={classNames["label"]}>
                        Dictionaries (JSON)
                        {dictionariesTextarea}
                    </label>
                </div>
            </div>
            {statusMessageElement}
        </div>
    );

    const loadConfig = () => {
        const currentConfig = configAccessor.getConfig();
        userIdInput.value = currentConfig.userId ?? "";
        apiRootInput.value = currentConfig.apiRoot ?? "";
        dictionariesTextarea.value = JSON.stringify(
            currentConfig.dictionaries,
            null,
            2,
        );
    };

    const { debounced: saveConfig } = debounce(() => {
        statusMessageElement.textContent = "Changes pending...";
        statusMessageElement.className = classNames["status-message"];

        try {
            const newConfig: Config = {
                version: "1",
                userId: userIdInput.value,
                apiRoot: apiRootInput.value,
                dictionaries: JSON.parse(dictionariesTextarea.value),
            };

            ConfigSchema.parse(newConfig);

            configAccessor.setConfig(newConfig);
            statusMessageElement.textContent = "Saved successfully!";
            statusMessageElement.classList.add(classNames.success);
            events.dispatchEvent(
                createTypedCustomEvent("config-saved", newConfig),
            );
        } catch (error) {
            let errorMessage = "Unknown error";
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            statusMessageElement.textContent = `Error saving configuration: ${errorMessage}`;
            statusMessageElement.classList.add(classNames.error);
            if (error instanceof ZodError) {
                events.dispatchEvent(
                    createTypedCustomEvent("config-save-error", error),
                );
            } else if (error instanceof Error) {
                events.dispatchEvent(
                    createTypedCustomEvent("config-save-error", error),
                );
            } else {
                events.dispatchEvent(
                    createTypedCustomEvent(
                        "config-save-error",
                        new Error(String(error)),
                    ),
                );
            }
        }
    }, 500);

    userIdInput.addEventListener("input", saveConfig);
    apiRootInput.addEventListener("input", saveConfig);
    dictionariesTextarea.addEventListener("input", saveConfig);

    loadConfig();

    return {
        element,
        cssText,
        events,
    };
}
