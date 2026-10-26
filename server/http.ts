import { ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

export function numericQuery(value: string | string[] | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

export function validIdQuery(value: string | string[] | undefined, multiple = false): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  const parts = value.split(',').map(part => part.trim());
  return (multiple || parts.length === 1) && parts.length <= 100 && parts.every(part =>
    /^\d+$/.test(part) && Number.isSafeInteger(Number(part)) && Number(part) > 0);
}
