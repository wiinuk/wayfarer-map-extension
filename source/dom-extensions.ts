
export function addNavigateListener(onHistoryChanged: () => void) {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        onHistoryChanged();
        return result;
    };
    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        onHistoryChanged();
        return result;
    };
    window.addEventListener("popstate", onHistoryChanged);
    onHistoryChanged();
}
