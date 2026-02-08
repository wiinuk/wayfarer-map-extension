import classNames, { variables, cssText } from "./indicator.module.css";
export function createIndicator() {
    const loader = (
        <div class={classNames.loader} aria-label="Communicating">
            <div class={classNames.orb}></div>
            <div class={classNames.orb}></div>
            <div class={classNames.orb}></div>
            <div class={classNames.orb}></div>
        </div>
    );
    const orbs = [
        ...loader.getElementsByClassName(classNames.orb),
    ] as OrbElement[];
    const intervals: ReturnType<typeof setTimeout>[] = [];

    function rand(min: number, max: number) {
        return Math.random() * (max - min) + min;
    }

    type OrbElement = HTMLElement & {
        _x: number;
        _y: number;
        _anim: ReturnType<typeof requestAnimationFrame>;
    };
    function setOrbPosition(orb: OrbElement, x: number, y: number) {
        orb.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
        orb._x = x;
        orb._y = y;
    }

    function animateOrbit(orb: OrbElement) {
        const radius = rand(5, 12);
        const duration = rand(2.5, 5);
        const drift = rand(-0.6, 0.6);

        const startAngle = Math.atan2(orb._y || 0, orb._x || 0);
        let start: DOMHighResTimeStamp | null = null;

        function frame(ts: DOMHighResTimeStamp) {
            if (!start) start = ts;
            const t = (ts - start) / 1000;
            const angle =
                startAngle +
                t * ((Math.PI * 2) / duration) +
                Math.sin(t) * drift;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            setOrbPosition(orb, x, y);
            orb._anim = requestAnimationFrame(frame);
        }
        orb._anim = requestAnimationFrame(frame);
    }

    function randomizePulse(orb: OrbElement) {
        orb.style.setProperty(variables["--pulseDur"], rand(2, 4) + "s");
    }

    function startCommunication() {
        loader.classList.remove(classNames.ending);
        loader.classList.add(classNames.starting);

        loader.classList.remove(classNames.starting);
        orbs.forEach((orb) => {
            orb.style.opacity = String(0.9);
            randomizePulse(orb);
            animateOrbit(orb);
            const id = setInterval(() => randomizePulse(orb), rand(3000, 5000));
            intervals.push(id);
        });
    }

    function stopCommunication() {
        loader.classList.add(classNames.ending);
        setTimeout(() => {
            intervals.forEach(clearInterval);
            intervals.length = 0;
            orbs.forEach((o) => cancelAnimationFrame(o._anim));
        }, 400);
    }

    stopCommunication();
    return {
        element: loader,
        cssText,
        start: startCommunication,
        stop: stopCommunication,
    };
}
