import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch'; // Using node-fetch v3 which is ESM compatible
// Corrected import path and added Monitor and MonitorLine (assuming MonitorLine is the type for lines in a monitor)
import { MonitorApiResponse, Monitor, MonitorLine } from '../types/api-models'; 

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  const divaParams = request.query.diva; // diva can be a string or an array of strings

  if (!divaParams) {
    response.status(400).json({ error: 'DIVA parameter(s) are required' });
    return;
  }

  const divaValues = Array.isArray(divaParams) ? divaParams : [divaParams as string];

  if (divaValues.length === 0) {
    // Send a valid MonitorApiResponse structure with empty monitors
    const emptyResponse: MonitorApiResponse = {
      data: { monitors: [] },
      message: { value: "No DIVA values provided for monitoring.", messageCode: 0, serverTime: new Date().toISOString() }
    };
    response.status(200).json(emptyResponse);
    return;
  }

  const baseUrl = 'https://www.wienerlinien.at/ogd_realtime/monitor';
  const divaQueryString = divaValues.map(diva => `diva=${encodeURIComponent(diva)}`).join('&');
  const fullUrl = `${baseUrl}?${divaQueryString}`;

  try {
    console.log(`[API Handler] Fetching from Wiener Linien: ${fullUrl}`);
    const apiResponseFromWienerLinien = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36', // Updated to a slightly newer Chrome UA
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        // 'Accept-Encoding': 'gzip, deflate, br' // node-fetch handles response decompression automatically
      }
    });

    if (!apiResponseFromWienerLinien.ok) {
      const errorText = await apiResponseFromWienerLinien.text();
      console.error(`[API Handler] Wiener Linien API error: ${apiResponseFromWienerLinien.status} ${apiResponseFromWienerLinien.statusText}`, errorText);
      response.status(apiResponseFromWienerLinien.status).json({ 
        error: 'Upstream API error', 
        details: `Wiener Linien API responded with ${apiResponseFromWienerLinien.status}: ${apiResponseFromWienerLinien.statusText}` 
      });
      return;
    }

    // Get the response as text first to be able to log it if JSON parsing fails
    const responseText = await apiResponseFromWienerLinien.text();
    let rawData: MonitorApiResponse;

    try {
      rawData = JSON.parse(responseText) as MonitorApiResponse;
    } catch (jsonParseError: any) {
      console.error('[API Handler] Failed to parse response from Wiener Linien as JSON. Status:', apiResponseFromWienerLinien.status, 'Response text preview:', responseText.substring(0, 1000) + (responseText.length > 1000 ? '...' : ''));
      response.status(500).json({ 
        error: 'Upstream API returned non-JSON response', 
        details: jsonParseError.message,
        responseTextPreview: responseText.substring(0, 200) + (responseText.length > 200 ? '...' : '')
      });
      return; // Exit after sending error
    }
    
    // Apply filtering logic (ensure this matches MonitorApiResponse structure)
    const allowedLineNames = ['U1', 'U2', 'U3', 'U4', 'U6'];
    if (rawData && rawData.data && rawData.data.monitors && Array.isArray(rawData.data.monitors)) {
      // Step 1: Process each monitor individually (filter lines, limit departures)
      const individuallyProcessedMonitors = rawData.data.monitors.map((monitor: Monitor) => {
        let linesWithLimitedDepartures: MonitorLine[] = [];
        if (monitor.lines && Array.isArray(monitor.lines)) {
          linesWithLimitedDepartures = monitor.lines
            .filter((line: MonitorLine) => allowedLineNames.includes(line.name))
            .map((line: MonitorLine) => {
              let updatedDeparturesData = line.departures;
              if (line.departures && line.departures.departure && Array.isArray(line.departures.departure)) {
                updatedDeparturesData = {
                  ...line.departures,
                  departure: line.departures.departure.slice(0, 3)
                };
              }
              return {
                ...line,
                departures: updatedDeparturesData
              };
            });
        }
        return {
          ...monitor,
          lines: linesWithLimitedDepartures
        };
      }).filter((monitor: Monitor) => monitor.lines && monitor.lines.length > 0);

      // Step 2: Aggregate processed monitors by station ID
      const groupedByStation = new Map<string, Monitor>();

      for (const monitor of individuallyProcessedMonitors) {
        const stationId = monitor.locationStop?.properties?.name; // e.g., "60200500"
        if (!stationId) {
          console.warn('[API Handler] Monitor found without a station ID (locationStop.properties.name), skipping:', monitor);
          continue;
        }

        if (!groupedByStation.has(stationId)) {
          // If this is the first time we see this station, initialize it
          // We use the current monitor's locationStop and attributes.
          // For locationStop, we might want to choose one with gate "1" or no gate if available,
          // but for now, the first one encountered is fine.
          groupedByStation.set(stationId, {
            locationStop: monitor.locationStop, // Takes the whole locationStop object
            lines: [...monitor.lines],          // Start with this monitor's lines
            attributes: monitor.attributes || {} // Take attributes, default to empty object
          });
        } else {
          // If station already exists, append lines from the current monitor
          const existingStationMonitor = groupedByStation.get(stationId)!; // Safe due to .has() check
          existingStationMonitor.lines.push(...monitor.lines);
        }
      }
      
      // Convert the Map values back to an array for the response
      rawData.data.monitors = Array.from(groupedByStation.values());
    }
    
    console.log(`[API Handler] Successfully fetched and filtered data. Monitor count: ${rawData.data?.monitors?.length ?? 0}`);
    response.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5'); // Cache for 10s on CDN
    response.status(200).json(rawData);

  } catch (error: any) {
    console.error('[API Handler] Internal server error fetching or processing data:', error);
    response.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
