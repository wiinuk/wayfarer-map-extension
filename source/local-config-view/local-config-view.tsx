import classNames, { cssText } from "./local-config-view.module.css";
import {
    ConfigSchema,
    type LocalConfigAccessor,
    type Config,
} from "../local-config";
import { createStringItemInput } from "./item-input-string";
import { createJsonItemInput } from "./item-input-json";

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
    const userIdInput = createStringItemInput("User ID");
    const apiRootInput = createStringItemInput("API Root");
    const dictionariesInput = createJsonItemInput("Dictionaries(JSON)");

    const statusMessageElement = (
        <div class={classNames["status-message"]}>Loading configuration...</div>
    ) as HTMLDivElement;

    const element = (
        <div class={classNames["container"]}>
            <div class={classNames["form-scroll"]}>
                {userIdInput.element}
                {apiRootInput.element}
                {dictionariesInput.element}
            </div>
            {statusMessageElement}
        </div>
    );

    const loadConfig = () => {
        const currentConfig = configAccessor.getConfig();

        userIdInput.setValue(currentConfig.userId);
        apiRootInput.setValue(currentConfig.apiRoot);
        dictionariesInput.setValue(currentConfig.dictionaries);
    };

    const { debounced: saveConfig } = debounce(() => {
        statusMessageElement.textContent = "Changes pending...";
        statusMessageElement.className = classNames["status-message"];

        try {
            let newConfig: Config = {
                version: "1",
            };

            newConfig = { ...newConfig, userId: userIdInput.getValue() };
            newConfig = { ...newConfig, apiRoot: apiRootInput.getValue() };
            newConfig = {
                ...newConfig,
                dictionaries: dictionariesInput.getValue() as
                    | Record<string, Record<string, string>>
                    | undefined,
            };

            ConfigSchema.parse(newConfig);

            configAccessor.setConfig(newConfig);
            statusMessageElement.textContent = "Saved successfully!";
            statusMessageElement.classList.add(classNames.success);
        } catch (error) {
            let errorMessage = "Unknown error";
            if (error instanceof Error) {
                errorMessage = error.message;
            }
            statusMessageElement.textContent = `Error saving configuration: ${errorMessage}`;
            statusMessageElement.classList.add(classNames.error);
        }
    }, 500);

    userIdInput.events.addEventListener("changed", saveConfig);
    apiRootInput.events.addEventListener("changed", saveConfig);
    dictionariesInput.events.addEventListener("changed", saveConfig);

    loadConfig();

    return {
        element,
        cssText: cssText + "\n" + userIdInput.cssText,
    };
}
