import { IncomingMessage, ServerResponse } from 'http';

export default function handler(
  req: IncomingMessage, // or VercelRequest
  res: ServerResponse
): void {
  res.setHeader("Content-Type", "text/plain");
  res.statusCode = 200;
  res.end("Hello from Vercel test.ts!!!!");
} 