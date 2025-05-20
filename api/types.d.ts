declare module '@dotenvx/dotenvx' {
  export function config(): void;
  export function get(key: string): string | undefined;
}
