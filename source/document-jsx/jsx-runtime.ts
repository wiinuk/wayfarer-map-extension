// spell-checker: ignore jsxs

type KnownElementTagNameMap = HTMLElementTagNameMap &
    SVGElementTagNameMap &
    FragmentTagNameMap;

interface FragmentTagNameMap {
    [Fragment]: DocumentFragment;
}

type EventHandlers<T> = {
    [K in keyof T as K extends `on${string}`
        ? K
        : never]?: T[K] extends // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((this: any, ev: infer E) => any) | null
        ? (ev: E) => void
        : never;
};

type KnownAttributeNameAndType<
    TTagName extends keyof KnownElementTagNameMap,
    TPropertyName extends keyof KnownElementTagNameMap[TTagName],
> = TPropertyName extends "classList"
    ? { name: "class"; type: string }
    : TPropertyName extends "htmlFor"
      ? { name: "for"; type: string }
      : KnownElementTagNameMap[TTagName][TPropertyName] extends
              | string
              | boolean
              | number
        ? {
              name: TPropertyName;
              type: KnownElementTagNameMap[TTagName][TPropertyName];
          }
        : KnownElementTagNameMap[TTagName][TPropertyName] extends SVGAnimatedLength
          ? {
                name: TPropertyName;
                type: number | string;
            }
          : KnownElementTagNameMap[TTagName][TPropertyName] extends SVGAnimatedEnumeration
            ? {
                  name: TPropertyName;
                  type: string;
              }
            : TPropertyName extends "style"
              ? {
                    name: TPropertyName;
                    type: string | ((style: CSSStyleDeclaration) => void);
                }
              : [TTagName, TPropertyName] extends ["marker", "orientAngle"]
                ? {
                      name: "orient";
                      type: string;
                  }
                : { name: never; type: never };

type KnownExtendedAttributes<TTagName extends keyof KnownElementTagNameMap> =
    TTagName extends typeof Fragment
        ? { readonly children?: Node | Node[] }
        : TTagName extends "path"
          ? {
                d: string;
                fill: string;
                stroke: string;
            }
          : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
            {};

type ElementProperties<TName extends keyof KnownElementTagNameMap> = {
    [k in keyof KnownElementTagNameMap[TName] as KnownAttributeNameAndType<
        TName,
        k
    >["name"]]?: KnownAttributeNameAndType<TName, k>["type"];
} & KnownExtendedAttributes<TName> &
    EventHandlers<KnownElementTagNameMap[TName]> & {
        readonly classList?: readonly string[];
        readonly children?: ChildrenProperty;
    };

type falsy = false | null | undefined | 0 | "" | void;
interface JsxOption {
    key?: string | number;
}
type Children = readonly (HTMLElement | string | falsy)[];
type ChildrenProperty =
    | readonly (HTMLElement | string | falsy)[]
    | HTMLElement
    | string
    | falsy;

export function jsxs<TName extends keyof KnownElementTagNameMap>(
    name: TName,
    properties: Readonly<ElementProperties<TName>> | null,
    _option?: JsxOption,
): KnownElementTagNameMap[TName] {
    if (name === Fragment) {
        return createFragment(
            (properties as Readonly<ElementProperties<typeof Fragment>>)
                .children,
        ) as KnownElementTagNameMap[TName];
    }
    const element = document.createElement(name);
    for (const [key, value] of Object.entries(properties ?? {})) {
        if (key === "children") continue;

        // イベントハンドラの処理
        if (key.startsWith("on") && typeof value === "function") {
            const eventName = key.substring(2).toLowerCase();
            element.addEventListener(eventName, value as EventListener);
            continue;
        }

        // style の処理
        if (key === "style" && typeof value === "function") {
            value(element.style);
            continue;
        }

        // classList の処理
        if (key === "classList" && value) {
            const classes = Array.isArray(value) ? value : [value];
            for (const c of classes) {
                if (typeof c === "string" && c) {
                    element.classList.add(c);
                }
            }
            continue;
        }

        // 通常の属性処理
        if (value !== undefined && value !== null) {
            element.setAttribute(key, String(value));
        }
    }

    // 子要素の追加処理
    const children = properties?.children;
    if (children) {
        if (Array.isArray(children)) {
            for (const child of children as Children) {
                if (!child) continue;
                element.append(child);
            }
        } else {
            element.append(children as HTMLElement | string);
        }
    }
    return element as KnownElementTagNameMap[TName];
}

export const jsx = jsxs;
export const Fragment = Symbol("Fragment");
function createFragment(children: Node | Node[] | undefined) {
    const fragment = document.createDocumentFragment();
    if (children != null) {
        if (Array.isArray(children)) {
            for (const child of children) {
                fragment.appendChild(child);
            }
        } else {
            fragment.appendChild(children);
        }
    }
    return fragment;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
    export type Element = HTMLElement;
    export type IntrinsicElements = {
        [tagName in keyof KnownElementTagNameMap]: ElementProperties<tagName>;
    };
}
