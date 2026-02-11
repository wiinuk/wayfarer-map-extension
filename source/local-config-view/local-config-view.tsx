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

    const dictionariesEnabledCheckbox = (
        <input type="checkbox" class={classNames["checkbox"]} />
    ) as HTMLInputElement;

    const userIdEnabledCheckbox = (
        <input type="checkbox" class={classNames["checkbox"]} />
    ) as HTMLInputElement;

    const userIdInputContainer = (
        <div class={classNames["form-group"]}>
            <label class={classNames["label"]}>{userIdInput}</label>
        </div>
    ) as HTMLDivElement;

    const apiRootEnabledCheckbox = (
        <input type="checkbox" class={classNames["checkbox"]} />
    ) as HTMLInputElement;

    const apiRootInputContainer = (
        <div class={classNames["form-group"]}>
            <label class={classNames["label"]}>{apiRootInput}</label>
        </div>
    ) as HTMLDivElement;

    const dictionariesInputContainer = (
        <div class={classNames["form-group"]}>
            <label class={classNames["label"]}>{dictionariesTextarea}</label>
        </div>
    ) as HTMLDivElement;

    const statusMessageElement = (
        <div class={classNames["status-message"]}>Loading configuration...</div>
    ) as HTMLDivElement;

    const element = (
        <div class={classNames["container"]}>
            <div class={classNames["form-scroll"]}>
                <div class={classNames["form-group"]}>
                    <label class={classNames["label"]}>
                        {userIdEnabledCheckbox}
                        <span>User ID</span>
                    </label>
                </div>
                {userIdInputContainer}

                <div class={classNames["form-group"]}>
                    <label class={classNames["label"]}>
                        {apiRootEnabledCheckbox}
                        <span>API Root</span>
                    </label>
                </div>
                {apiRootInputContainer}

                <div class={classNames["form-group"]}>
                    <label class={classNames["label"]}>
                        {dictionariesEnabledCheckbox}
                        <span>Dictionaries(JSON)</span>
                    </label>
                </div>
                {dictionariesInputContainer}
            </div>
            {statusMessageElement}
        </div>
    );

    const loadConfig = () => {
        const currentConfig = configAccessor.getConfig();

        const hasUserId = currentConfig.userId !== undefined;
        userIdEnabledCheckbox.checked = hasUserId;
        userIdInput.disabled = !hasUserId;
        userIdInputContainer.style.display = hasUserId ? "" : "none";
        userIdInput.value = hasUserId ? (currentConfig.userId ?? "") : "";

        const hasApiRoot = currentConfig.apiRoot !== undefined;
        apiRootEnabledCheckbox.checked = hasApiRoot;
        apiRootInput.disabled = !hasApiRoot;
        apiRootInputContainer.style.display = hasApiRoot ? "" : "none";
        apiRootInput.value = hasApiRoot ? (currentConfig.apiRoot ?? "") : "";

        const hasDictionaries = currentConfig.dictionaries !== undefined;
        dictionariesEnabledCheckbox.checked = hasDictionaries;
        dictionariesTextarea.disabled = !hasDictionaries;
        dictionariesInputContainer.style.display = hasDictionaries
            ? ""
            : "none";
        dictionariesTextarea.value = hasDictionaries
            ? JSON.stringify(currentConfig.dictionaries, null, 2)
            : "";
    };

    const { debounced: saveConfig } = debounce(() => {
        statusMessageElement.textContent = "Changes pending...";
        statusMessageElement.className = classNames["status-message"];

        try {
            let newConfig: Config = {
                version: "1",
            };

            if (userIdEnabledCheckbox.checked) {
                newConfig = {
                    ...newConfig,
                    userId: userIdInput.value,
                };
            }

            if (apiRootEnabledCheckbox.checked) {
                newConfig = {
                    ...newConfig,
                    apiRoot: apiRootInput.value,
                };
            }

            if (dictionariesEnabledCheckbox.checked) {
                try {
                    const parsedDictionaries = JSON.parse(
                        dictionariesTextarea.value,
                    );
                    newConfig = {
                        ...newConfig,
                        dictionaries: parsedDictionaries,
                    };
                } catch {
                    throw new Error(
                        "Invalid Dictionaries JSON. Please check the syntax.",
                    );
                }
            }

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

    dictionariesEnabledCheckbox.addEventListener("change", () => {
        const isChecked = dictionariesEnabledCheckbox.checked;
        dictionariesTextarea.disabled = !isChecked;
        dictionariesInputContainer.style.display = isChecked ? "" : "none";
        saveConfig();
    });

    userIdEnabledCheckbox.addEventListener("change", () => {
        const isChecked = userIdEnabledCheckbox.checked;
        userIdInput.disabled = !isChecked;
        userIdInputContainer.style.display = isChecked ? "" : "none";
        saveConfig();
    });

    apiRootEnabledCheckbox.addEventListener("change", () => {
        const isChecked = apiRootEnabledCheckbox.checked;
        apiRootInput.disabled = !isChecked;
        apiRootInputContainer.style.display = isChecked ? "" : "none";
        saveConfig();
    });

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
