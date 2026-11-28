declare module "*?raw" {
  const text: string;
  export default text;
}

// import.meta.glob (used to scan the dashboard's sources).
interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
