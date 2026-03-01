//spell:words Hiragino Kaku Meiryo Neue Pokestop powerspot wayspot

export type OverlayOptions = ReturnType<typeof createOverlayViewOptions>;
export type WayspotLabelOptions = OverlayOptions["wayspotLabelOptions"];
export type Cell17Options = OverlayOptions["cell17EmptyOptions"];
export function createOverlayViewOptions() {
    const cellBaseZIndex = 3100;
    const poiBaseZIndex = cellBaseZIndex + 100;
    const poiLabelBaseZIndex = poiBaseZIndex + 100;
    const statLabelBaseZIndex = poiLabelBaseZIndex + 100;

    const cell17EmptyOptions = Object.freeze({
        strokeColor: "rgba(253, 255, 114, 0.4)",
        strokeWeight: 1,
        fillColor: "#0000002d",
        clickable: false,
        zIndex: cellBaseZIndex + 1,
    } satisfies google.maps.PolygonOptions);

    const cell17PokestopOptions = Object.freeze({
        ...cell17EmptyOptions,

        fillColor: "rgba(0, 191, 255, 0.4)",
        strokeColor: "rgba(0, 191, 255, 0.6)",
        zIndex: cellBaseZIndex,
    } satisfies google.maps.PolygonOptions);

    const cell17GymOptions = Object.freeze({
        ...cell17PokestopOptions,

        fillColor: "rgba(255, 0, 13, 0.4)",
        strokeColor: "rgba(255, 0, 13, 0.6)",
    } satisfies google.maps.PolygonOptions);

    const cell14Options = Object.freeze({
        strokeColor: "#c54545b7",
        strokeWeight: 2,
        fillColor: "transparent",
        clickable: false,
        zIndex: cellBaseZIndex + 2,
    } satisfies google.maps.PolygonOptions);

    const cell14OptionsEmpty = cell14Options;
    const cell14Options1 = Object.freeze({
        ...cell14Options,
        fillColor: "#dd767625",
    } satisfies google.maps.PolygonOptions);

    const cell14Options2 = Object.freeze({
        ...cell14Options,
        fillColor: "#d3b71738",
    } satisfies google.maps.PolygonOptions);

    const wayspotOptions = Object.freeze({
        markerSize: 8,
        borderColor: "#ff6600",
        borderWidth: 2,
        fillColor: "#ff660080",
        zIndex: poiBaseZIndex,
    });
    const gymOptions = Object.freeze({
        ...wayspotOptions,
        borderColor: "#ffffff",
        fillColor: "#ff2450",
    });
    const pokestopOptions = Object.freeze({
        ...wayspotOptions,
        borderColor: "#0000cd",
        fillColor: "#00bfff",
    });
    const powerspotOptions = Object.freeze({
        ...wayspotOptions,
        borderColor: "#e762d3",
        fillColor: "#f195eb",
    });

    const wayspotLabelOptions = {
        font: `11px "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif`,
        strokeColor: "rgb(0, 0, 0)",
        fillColor: "#FFFFBB",
        strokeWeight: 2,
        lineJoin: "round" as CanvasLineJoin,
        shadowBlur: 1,
    };
    const gymLabelOptions = Object.freeze({
        ...wayspotLabelOptions,
        font: `bold ` + wayspotLabelOptions.font,
        strokeColor: "#ffffffd5",
        fillColor: "#9c1933",
    });
    const powerspotLabelOptions = Object.freeze({
        ...wayspotLabelOptions,
        strokeColor: "#e762d3",
    });
    return {
        cell17EmptyOptions,
        cell17PokestopOptions,
        cell17GymOptions,
        cell14Options,
        cell14OptionsEmpty,
        cell14Options1,
        cell14Options2,
        wayspotOptions,
        gymOptions,
        pokestopOptions,
        powerspotOptions,
        wayspotLabelOptions,
        gymLabelOptions,
        powerspotLabelOptions,
        cellBaseZIndex,
        poiBaseZIndex,
        poiLabelBaseZIndex,
        statLabelBaseZIndex,
    };
}
