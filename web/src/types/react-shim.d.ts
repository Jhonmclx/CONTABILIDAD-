// Tipos mínimos de React usados por el proyecto (el entorno de compilación no
// tiene acceso al registro npm para descargar @types/react).
declare module 'react' {
  export type ReactNode = any;
  export type FC<P = {}> = (props: P & { children?: ReactNode }) => any;
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export interface MutableRefObject<T> { current: T }
  export interface Context<T> { Provider: any; Consumer: any; _t?: T }
  export type FormEvent<T = any> = { preventDefault(): void; target: T; currentTarget: T };
  export type ChangeEvent<T = any> = { target: T; currentTarget: T };
  export type CSSProperties = Record<string, any>;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly any[]): T;
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: readonly any[]): T;
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): MutableRefObject<T | null>;
  export function useContext<T>(ctx: Context<T>): T;
  export function createContext<T>(value: T): Context<T>;
  export function useId(): string;
  export const Fragment: any;
  export const StrictMode: any;
  const React: any;
  export default React;
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react-dom/client' { export function createRoot(el: Element): { render(node: any): void }; }
declare namespace JSX {
  interface IntrinsicElements { [elem: string]: any }
  interface Element {}
  interface ElementChildrenAttribute { children: {} }
}
declare module '*.css';
declare namespace JSX { interface IntrinsicAttributes { key?: any } }
