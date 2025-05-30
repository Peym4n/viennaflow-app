import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { createHmac } from 'crypto';
import fetch from 'node-fetch'; // Using node-fetch for server-side HTTP requests
import dotenvx from '@dotenvx/dotenvx';

// Attempt to configure dotenvx
try {
  dotenvx.config();
} catch (e) {
  console.warn('dotenvx.config() failed in /api/routes/walking-matrix.ts, possibly already configured or no .env file found in this context.', e);
}

const UPSTASH_URL = dotenvx.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_TOKEN = dotenvx.get('UPSTASH_REDIS_REST_TOKEN');
const GOOGLE_MAPS_SERVER_KEY = dotenvx.get('GOOGLE_MAPS_SERVER_API_KEY');

let redis: Redis;

if (UPSTASH_URL && UPSTASH_TOKEN) {
  redis = new Redis({
    url: UPSTASH_URL,
    token: UPSTASH_TOKEN,
  });
} else {
  console.error('CRITICAL: Upstash Redis URL or Token is not configured for walking-matrix. Redis client not initialized.');
}


const TIMESTAMP_VALIDITY_SECONDS = 5 * 60; // 5 minutes

// Define a simple LatLngLiteral for server-side use
interface LatLngLiteral {
  lat: number;
  lng: number;
}
interface WalkingMatrixPayload {
  origins: LatLngLiteral[]; // Expecting an array with one origin
  destinations: LatLngLiteral[];
}

// Define a basic structure for the expected Google Distance Matrix API response
interface GoogleDistanceMatrixResponse {
    destination_addresses: string[];
    origin_addresses: string[];
    rows: {
        elements: {
            status: string; // e.g., "OK", "NOT_FOUND", "ZERO_RESULTS"
            duration?: { text: string; value: number }; // value in seconds
            distance?: { text: string; value: number }; // value in meters
        }[];
    }[];
    status: string; // Overall status, e.g., "OK", "REQUEST_DENIED"
    error_message?: string;
}


export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).send('Method Not Allowed');
  }

  const receivedTimestampStr = req.headers['x-timestamp'] as string;
  const receivedSignature = req.headers['x-signature'] as string;
  const sessionId = req.cookies['sessionId']; // Vercel parses cookies automatically
  const requestBody = req.body as WalkingMatrixPayload;

  if (!receivedTimestampStr || !receivedSignature || !sessionId || !requestBody) {
    return res.status(400).json({ error: 'Missing signature components or session ID.' });
  }

  if (!UPSTASH_URL || !UPSTASH_TOKEN || !redis) {
    console.error('CRITICAL: Upstash Redis environment variables not set or Redis client failed to initialize for /api/routes/walking-matrix handler.');
    return res.status(500).json({ error: 'Server configuration error regarding Redis connection.' });
  }
  if (!GOOGLE_MAPS_SERVER_KEY) {
    console.error('CRITICAL: Google Maps Server API key not configured for /api/routes/walking-matrix handler.');
    return res.status(500).json({ error: 'Server configuration error regarding Google API key.' });
  }

  // 1. Validate Timestamp
  const receivedTimestamp = parseInt(receivedTimestampStr, 10);
  if (isNaN(receivedTimestamp)) {
    return res.status(400).json({ error: 'Invalid timestamp format.' });
  }
  const currentTimeSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimeSeconds - receivedTimestamp) > TIMESTAMP_VALIDITY_SECONDS) {
    return res.status(401).json({ error: 'Expired timestamp.' });
  }

  // 2. Fetch sessionSigningKey from Redis
  let sessionSigningKey: string | null = null;
  try {
    sessionSigningKey = await redis.get(sessionId);
  } catch (redisError) {
    console.error('Redis error fetching session key:', redisError);
    return res.status(500).json({ error: 'Session validation error.' });
  }

  if (!sessionSigningKey) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  // 3. Reconstruct the message and verify HMAC signature
  // Ensure consistent stringification if the client stringifies.
  // Here, Vercel's req.body is already a parsed object if Content-Type was application/json.
  const messageToSign = receivedTimestampStr + '.' + JSON.stringify(requestBody);
  const expectedSignature = createHmac('sha256', sessionSigningKey)
    .update(messageToSign)
    .digest('hex');

  if (expectedSignature !== receivedSignature) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  // 4. Input Validation for Google API
  if (!requestBody.origins || requestBody.origins.length !== 1 || !requestBody.destinations || requestBody.destinations.length === 0) {
    return res.status(400).json({ error: 'Invalid origins or destinations in payload.' });
  }
  // Add more validation for coordinates format, number of destinations, etc. if needed.
  const MAX_DESTINATIONS = 25; // Google's limit for origins*destinations is 625, 1 origin * 25 dest = 25 elements.
  if (requestBody.destinations.length > MAX_DESTINATIONS) {
     return res.status(400).json({ error: `Too many destinations. Maximum allowed is ${MAX_DESTINATIONS}.` });
  }


  // 5. Call Google Distance Matrix API
  try {
    const originsString = requestBody.origins.map(o => `${o.lat},${o.lng}`).join('|');
    const destinationsString = requestBody.destinations.map(d => `${d.lat},${d.lng}`).join('|');
    
    const googleApiUrl = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    googleApiUrl.searchParams.append('origins', originsString);
    googleApiUrl.searchParams.append('destinations', destinationsString);
    googleApiUrl.searchParams.append('mode', 'walking');
    googleApiUrl.searchParams.append('units', 'metric');
    googleApiUrl.searchParams.append('key', GOOGLE_MAPS_SERVER_KEY);

    const googleResponse = await fetch(googleApiUrl.toString());
    // Cast the JSON response to our defined interface
    const googleResponseData = await googleResponse.json() as GoogleDistanceMatrixResponse;

    if (!googleResponse.ok || googleResponseData.status !== 'OK') {
      console.error('Google Distance Matrix API error:', googleResponseData);
      return res.status(502).json({ error: 'Failed to retrieve data from Google Maps.', details: googleResponseData.error_message || googleResponseData.status });
    }

    return res.status(200).json(googleResponseData);

  } catch (error) {
    console.error('Error calling Google Distance Matrix API:', error);
    return res.status(500).json({ error: 'Failed to process request with Google Maps.' });
  }
}
