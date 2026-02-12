import classNames, { cssText, variables } from "./dialog.module.css";

function makeDraggable(
    element: HTMLElement,
    handleElement = element,
    options?: {
        propertyNames?: { left: string; top: string };
    },
) {
    let offsetX = 0,
        offsetY = 0;

    function setPosition(left: number, top: number) {
        const rect = element.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // ウインドウ内に収まるようにする
        left = Math.max(0, Math.min(left, windowWidth - rect.width));
        top = Math.max(0, Math.min(top, windowHeight - rect.height));

        if (options?.propertyNames) {
            const { left: leftName, top: topName } = options.propertyNames;
            element.style.setProperty(leftName, `${left}px`);
            element.style.setProperty(topName, `${top}px`);
        } else {
            element.style.left = `${left}px`;
            element.style.top = `${top}px`;
        }
    }

    const onPointerMove = (e: PointerEvent) => {
        setPosition(e.clientX - offsetX, e.clientY - offsetY);
    };
    handleElement.addEventListener("pointerdown", (e) => {
        handleElement.addEventListener("pointermove", onPointerMove);
        handleElement.setPointerCapture(e.pointerId);
        offsetX = e.clientX - element.offsetLeft;
        offsetY = e.clientY - element.offsetTop;
    });
    handleElement.addEventListener("pointerup", (e) => {
        handleElement.removeEventListener("pointermove", onPointerMove);
        handleElement.releasePointerCapture(e.pointerId);
    });

    // ウインドウサイズに合わせてサイズを変更する
    function adjustSize() {
        const rect = element.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        if (rect.width > windowWidth) {
            element.style.width = `${windowWidth}px`;
        }
        if (rect.height > windowHeight) {
            element.style.height = `${windowHeight}px`;
        }
        setPosition(rect.left, rect.top);
    }
    window.addEventListener("resize", adjustSize);
    adjustSize();
}

export function createDialog(
    innerElement: HTMLElement,
    options?: { title?: string | HTMLElement },
) {
    const titleSpan = (
        <div class={classNames["titlebar-title"]}>{options?.title ?? ""}</div>
    );
    const dialogElement = (
        <div class={classNames["dialog"]}>
            {
                <div
                    class={classNames["titlebar"]}
                    ondblclick={toggleMaximizedState}
                >
                    {titleSpan}
                    <div class={classNames["titlebar-right-controls"]}>
                        <button
                            classList={[
                                classNames["titlebar-button"],
                                classNames["minimize-toggle-button"],
                            ]}
                            title="minimize"
                            onclick={toggleMinimizedState}
                        />
                        <button
                            classList={[
                                classNames["titlebar-button"],
                                classNames["maximize-toggle-button"],
                            ]}
                            title="maximize"
                            onclick={toggleMaximizedState}
                        />
                        <button
                            class={classNames["titlebar-button"]}
                            title="close"
                            onclick={hide}
                        >
                            ×
                        </button>
                    </div>
                </div>
            }
            <div class={classNames["inner-container"]}>{innerElement}</div>
        </div>
    );

    makeDraggable(dialogElement, titleSpan, {
        propertyNames: {
            left: variables["--drag-left"],
            top: variables["--drag-top"],
        },
    });

    function show() {
        document.body.appendChild(dialogElement);
    }
    function hide() {
        document.body.removeChild(dialogElement);
    }
    function toggleMaximizedState() {
        dialogElement.classList.remove(classNames["minimized"]);
        dialogElement.classList.toggle(classNames["maximized"]);
    }
    function toggleMinimizedState() {
        dialogElement.classList.remove(classNames["maximized"]);
        dialogElement.classList.toggle(classNames["minimized"]);
    }
    return {
        show,
        hide,
        cssText,
        element: dialogElement,
        setTitle(title: string | HTMLElement) {
            titleSpan.innerHTML = "";
            titleSpan.append(title);
        },
        setForegroundColor(cssColorText: string) {
            dialogElement.style.setProperty(
                variables["--external-foreground-color"],
                cssColorText,
            );
        },
        setBackgroundColor(cssColorText: string) {
            dialogElement.style.setProperty(
                variables["--external-background-color"],
                cssColorText,
            );
        },
    };
}
