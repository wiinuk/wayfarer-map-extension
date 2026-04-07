// spell: words iconmenu wfmapmods
import { awaitElement } from "./standard-extensions";

export async function modifyWfMapLocation(signal: AbortSignal) {
    const controls = await awaitElement(
        () => document.getElementById("wfmapmods-topright-controls"),
        { signal },
    );
    const locationButton = await awaitElement(
        () => document.getElementById("wfmapmods-geo-btn"),
        {
            signal,
        },
    );

    locationButton.removeAttribute("id");
    locationButton.classList.add("wfmapmods-iconmenu-toggle");
    locationButton
        .querySelector("img")
        ?.classList.add("wfmapmods-iconmenu-icon");
    const menuButton = <div class="wfmapmods-iconmenu">{locationButton}</div>;

    controls.append(menuButton);
}
