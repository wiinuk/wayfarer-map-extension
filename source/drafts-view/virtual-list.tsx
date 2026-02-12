import classNames, { cssText, variables } from "./virtual-list.module.css";

export interface VirtualElements {
    /** px */
    readonly itemHeight: number;
    readonly count: number;
    get(index: number): HTMLElement | undefined;
}
function createEmptyElements(): VirtualElements {
    return {
        itemHeight: 0,
        count: 0,
        get() {
            return undefined;
        },
    };
}
export function createVirtualList() {
    const list = <ul class={classNames["list"]}></ul>;
    const listSpacer = <div class={classNames["list-spacer"]}>{list}</div>;
    const listWindow = (
        <div class={classNames["list-window"]} onscroll={update}>
            {listSpacer}
        </div>
    );
    let items = createEmptyElements();

    let redrawRequested = true;
    let lastStart: number | null = null;
    let lastCount: number | null = null;
    function update() {
        const { scrollTop, offsetHeight: windowHeight } = listWindow;
        const { itemHeight, count: itemCount } = items;

        const start = Math.floor(scrollTop / itemHeight);
        const count =
            Math.min(
                itemCount,
                Math.ceil((scrollTop + windowHeight) / itemHeight),
            ) - start;

        redrawRequested =
            redrawRequested || lastStart !== start || lastCount !== count;
        lastStart = start;
        lastCount = count;

        if (!redrawRequested) return;
        redrawRequested = false;

        list.innerHTML = "";
        for (let i = 0; i < count; i++) {
            list.append(
                <li class={classNames.item}>{items.get(start + i)}</li>,
            );
        }
        listWindow.style.setProperty(
            variables["--item-height"],
            itemHeight + "px",
        );
        listWindow.style.setProperty(
            variables["--list-height"],
            itemHeight * itemCount + "px",
        );
        listWindow.style.setProperty(
            variables["--list-offset-top"],
            start * itemHeight + "px",
        );
    }
    function setItems(newItems: VirtualElements) {
        items = newItems;
        redrawRequested = true;
        return update();
    }

    new ResizeObserver((entries) => {
        for (const _ of entries) void update();
    }).observe(listWindow);

    return {
        element: listWindow,
        cssText,
        setItems,
    };
}
