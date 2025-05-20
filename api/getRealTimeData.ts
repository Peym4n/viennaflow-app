import axios, { AxiosError } from "axios";
import { IncomingMessage, ServerResponse } from 'http';

// Define a type for the expected query parameters
interface QueryParams {
  rbl?: string | string[];
}

// Extend IncomingMessage to include query
interface VercelRequest extends IncomingMessage {
  query: QueryParams;
}

// Helper to send JSON response
function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Define a type for the expected response data from Wiener Linien (if known)
// For now, using 'any'. Replace with a specific type if the structure is defined.
type WienerLinienMonitorData = any;

export default async function handler(
  req: VercelRequest,
  res: ServerResponse
): Promise<void> {
  const { rbl } = req.query;

  // Ensure rbl is a single string
  const rblParam = Array.isArray(rbl) ? rbl[0] : rbl;

  if (!rblParam) {
    sendJson(res, 400, { error: "RBL number is mandatory." });
    return;
  }

  // console.log(`Fetching real-time data for RBL: ${rblParam}`); // Optional: more descriptive log

  try {
    const response = await axios.get<WienerLinienMonitorData>(
      `https://www.wienerlinien.at/ogd_realtime/monitor?rbl=${rblParam}`
    );

    // console.log("Data from Wiener Linien:", response.data); // Log the actual data received
    sendJson(res, 200, response.data);

  } catch (error) {
    // console.error("Error fetching real-time data:", error); // Log the full error for debugging
    
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      // Log more specific Axios error details
      // console.error("Axios error details:", {
      //   message: axiosError.message,
      //   code: axiosError.code,
      //   status: axiosError.response?.status,
      //   data: axiosError.response?.data,
      // });
      sendJson(res, axiosError.response?.status || 500, { 
        error: "Failed to fetch real-time data from provider.",
        providerError: axiosError.response?.data 
      });
    } else {
      sendJson(res, 500, { error: "An unexpected error occurred." });
    }
  }
} 