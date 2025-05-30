import { Redis } from '@upstash/redis';
import { IncomingMessage, ServerResponse } from 'http';
import { get as getEnv } from '@dotenvx/dotenvx';
import { MonitorApiResponse, Monitor, MonitorLine } from '../../types/api-models';

// Use custom interface to match Vercel's serverless function API
interface Request extends IncomingMessage {
  body: any;
  method: string;
}

interface Response extends ServerResponse {
  status(code: number): Response;
  json(body: any): void;
}

// In-memory cache for local development when Redis isn't available
class MemoryCache {
  private cache = new Map<string, { value: any; expires?: number }>();
  private locks = new Map<string, boolean>();
  private sortedSets = new Map<string, Map<string, number>>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    if (item.expires && item.expires < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return item.value as T;
  }

  async set(key: string, value: any, options?: { ex?: number; nx?: boolean }): Promise<boolean> {
    if (options?.nx && this.cache.has(key)) return false;
    
    this.cache.set(key, {
      value,
      expires: options?.ex ? Date.now() + options.ex * 1000 : undefined
    });
    return true;
  }

  async del(key: string): Promise<number> {
    const deleted = this.cache.delete(key);
    return deleted ? 1 : 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.cache.get(key);
    if (!item) return 0;
    item.expires = Date.now() + seconds * 1000;
    return 1;
  }

  async zadd(key: string, options: { score: number; member: string }): Promise<number> {
    if (!this.sortedSets.has(key)) {
      this.sortedSets.set(key, new Map());
    }
    const set = this.sortedSets.get(key)!;
    const isNew = !set.has(options.member);
    set.set(options.member, options.score);
    return isNew ? 1 : 0;
  }

  async zrange(key: string, start: number, end: number, options?: { withScores?: boolean }): Promise<string[]> {
    const set = this.sortedSets.get(key);
    if (!set) return [];
    
    // Sort by score (lowest to highest)
    const sorted = [...set.entries()].sort((a, b) => a[1] - b[1]);
    
    // Handle negative indices
    const actualStart = start < 0 ? sorted.length + start : start;
    const actualEnd = end < 0 ? sorted.length + end : end === -1 ? sorted.length - 1 : end;
    
    const result: string[] = [];
    for (let i = actualStart; i <= actualEnd && i < sorted.length; i++) {
      result.push(sorted[i][0]); // Member
      if (options?.withScores) {
        result.push(String(sorted[i][1])); // Score
      }
    }
    
    return result;
  }

  async zrem(key: string, members: string[]): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed++;
      }
    }
    return removed;
  }
}

// Initialize Redis client with dotenvx for encrypted environment variables
let redis: Redis | MemoryCache;

// Always try to use Redis first
try {
  const restUrl = getEnv('UPSTASH_REDIS_REST_URL');
  const restToken = getEnv('UPSTASH_REDIS_REST_TOKEN');
  
  if (!restUrl || !restToken) {
    throw new Error('Missing Upstash Redis REST environment variables');
  }
  
  redis = new Redis({
    url: restUrl,
    token: restToken
  });
  
  // Test the connection by setting a simple key
  redis.set('connection_test', 'connected', { ex: 10 })
    .then(() => console.log('Successfully connected to Upstash Redis REST API'))
    .catch(err => {
      console.warn('Redis connection test failed, falling back to in-memory cache:', err?.message);
      redis = new MemoryCache();
    });
} catch (error: any) {
  console.warn('Redis initialization failed, using in-memory cache:', error?.message || 'Unknown error');
  redis = new MemoryCache();
}

// Redis keys for request management and throttling
const LAST_REQUEST_KEY = 'wienerlinien:last_request_time';
const REQUEST_LOCK_KEY = 'wienerlinien:request_lock';
const PENDING_DIVA_REQUESTS_KEY = 'wienerlinien:pending_diva_requests';
const FETCHING_STATUS_KEY = 'wienerlinien:fetching_status';
const THROTTLE_TIME_MS = 15000; // 15 seconds
const PENDING_REQUEST_TTL = 60; // 1 minute max for pending requests

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { divaIds } = req.body;
    
    if (!divaIds || !Array.isArray(divaIds) || divaIds.length === 0) {
      return res.status(400).json({ error: 'Invalid request, divaIds array required' });
    }
    
    // Sort and normalize DIVAs for consistent caching
    const normalizedDivaIds = divaIds.map(String).sort();
    
    // Try to get each DIVA from cache individually
    const cachedMonitors: any[] = [];
    const missingDivaIds: string[] = [];
    
    // Check cache for each individual DIVA
    for (const divaId of normalizedDivaIds) {
      const stationCacheKey = `monitor:station:${divaId}`;
      const cachedStation = await redis.get(stationCacheKey);
      
      if (cachedStation) {
        console.log(`Cache hit for ${divaId} during direct check`);
        cachedMonitors.push(cachedStation);
      } else {
        console.log(`DIVA ${divaId} not in cache, will fetch`);
        missingDivaIds.push(divaId);
      }
    }
    
    // If we have all DIVAs in cache, return combined result
    if (missingDivaIds.length === 0) {
      console.log('All DIVAs found in cache, returning combined result');
      const combinedResponse: MonitorApiResponse = {
        data: {
          monitors: cachedMonitors
        },
        message: {
          value: 'Data from cache',
          messageCode: 1,
          serverTime: new Date().toISOString()
        },
        timestamp: Date.now()
      };
      return res.status(200).json(combinedResponse);
    }
    
    // Only proceed with API call if we have missing DIVAs
    // Get the last request time from Redis
    const lastRequestTime = parseInt(await redis.get<string>(LAST_REQUEST_KEY) || '0');
    const currentTime = Date.now();
    const timeSinceLastRequest = currentTime - lastRequestTime;
    
    if (timeSinceLastRequest < THROTTLE_TIME_MS && missingDivaIds.length > 0) {
      // We need to wait for the throttle period to pass
      const waitTime = THROTTLE_TIME_MS - timeSinceLastRequest;
      
      console.log(`Waiting ${waitTime}ms for throttle period to pass for missing DIVAs: ${missingDivaIds.join(', ')}`);
      
      // Wait for the throttle period to pass
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // After waiting, check cache again for missing DIVAs
      const stillMissingDivaIds: string[] = [];
      for (const divaId of missingDivaIds) {
        const stationCacheKey = `monitor:station:${divaId}`;
        const cachedStation = await redis.get(stationCacheKey);
        
        if (cachedStation) {
          console.log(`Cache hit for ${divaId} after waiting`);
          cachedMonitors.push(cachedStation);
        } else {
          stillMissingDivaIds.push(divaId);
        }
      }
      
      // If all DIVAs are now in cache, return combined result
      if (stillMissingDivaIds.length === 0) {
        console.log('After waiting, all DIVAs now in cache');
        const combinedResponse: MonitorApiResponse = {
          data: {
            monitors: cachedMonitors
          },
          message: {
            value: 'Data from cache after waiting',
            messageCode: 1,
            serverTime: new Date().toISOString()
          },
          timestamp: Date.now()
        };
        return res.status(200).json(combinedResponse);
      }
      
      // Update our list of missing DIVAs
      missingDivaIds.length = 0;
      missingDivaIds.push(...stillMissingDivaIds);
    }
    
    // Only proceed if we still have missing stations
    if (missingDivaIds.length === 0) {
      // All stations were in cache, return combined result
      const combinedResponse: MonitorApiResponse = {
        data: {
          monitors: cachedMonitors
        },
        message: {
          value: 'All data from cache',
          messageCode: 1,
          serverTime: new Date().toISOString()
        },
        timestamp: Date.now()
      };
      return res.status(200).json(combinedResponse);
    }
    
    // Register our missing DIVAs in the pending requests queue
    for (const divaId of missingDivaIds) {
      await redis.zadd(PENDING_DIVA_REQUESTS_KEY, {
        score: Date.now(),
        member: divaId
      });
    }
    // Set expiry on the sorted set if not already set
    await redis.expire(PENDING_DIVA_REQUESTS_KEY, PENDING_REQUEST_TTL);
    
    // Acquire a lock to ensure only one instance makes the API call
    const lockAcquired = await redis.set(REQUEST_LOCK_KEY, '1', { 
      nx: true, // Only set if it doesn't exist
      ex: 5 // 5 second expiry as safety measure
    });
    
    if (!lockAcquired) {
      // Another instance is making the API call, check if it's already in process
      console.log(`Another instance is making the API call, waiting for missing stations: ${missingDivaIds.join(', ')}`);
      
      // Check if someone is already fetching
      const fetchingStatusRaw = await redis.get(FETCHING_STATUS_KEY);
      
      if (fetchingStatusRaw) {
        let fetchingStatus: { status: string; fetchedDivaIds?: string[] } = { status: 'unknown' };
        try {
          fetchingStatus = JSON.parse(fetchingStatusRaw as string);
        } catch {
          // Handle legacy format or unparseable data
          fetchingStatus = { status: fetchingStatusRaw as string };
        }
        
        if (fetchingStatus.status === 'fetching') {
          console.log('Another instance is actively fetching RBLs, registered ours in queue');
          
          // Wait for results
          let waitLoopComplete = false;
          for (let i = 0; i < 12; i++) { // Wait up to 6 seconds
            await new Promise(resolve => setTimeout(resolve, 500));
            // Check if the fetching process completed
            const currentStatusRaw = await redis.get(FETCHING_STATUS_KEY);
            let currentStatus: { status: string; fetchedDivaIds?: string[] } = { status: 'unknown' };
            
            try {
              if (currentStatusRaw) {
                currentStatus = JSON.parse(currentStatusRaw as string);
              }
            } catch {
              // Handle unparseable data
            }
            
            if (currentStatus.status === 'done' && Array.isArray(currentStatus.fetchedDivaIds)) {
              console.log('Fetching completed, checking if our DIVAs were included');
              
              // Check if any of our DIVAs were fetched
              const fetchedDivaSet = new Set(currentStatus.fetchedDivaIds);
              
              // Check for each of our missing DIVAs
              for (const divaId of [...missingDivaIds]) {
                if (fetchedDivaSet.has(divaId)) {
                  // This DIVA was fetched, get it from cache
                  const stationCacheKey = `monitor:station:${divaId}`;
                  const cachedStation = await redis.get(stationCacheKey);
                  
                  if (cachedStation) {
                    cachedMonitors.push(cachedStation);
                    // Remove from our missing list
                    missingDivaIds.splice(missingDivaIds.indexOf(divaId), 1);
                  }
                }
              }
              
              // If we still have missing DIVAs after checking, they weren't fetched
              if (missingDivaIds.length === 0) {
                // All stations now in cache
                waitLoopComplete = true;
              } else {
                console.log(`Some stations weren't fetched: ${missingDivaIds.join(', ')}`);
                // They remain in the queue for the next instance
              }
            }
            
            // Also check cache directly in case status reporting failed
            let allFound = true;
            for (const divaId of [...missingDivaIds]) {
              const stationCacheKey = `monitor:station:${divaId}`;
              const cachedStation = await redis.get(stationCacheKey);
              
              if (cachedStation) {
                cachedMonitors.push(cachedStation);
                missingDivaIds.splice(missingDivaIds.indexOf(divaId), 1);
              } else {
                allFound = false;
              }
            }
            
            if (allFound) {
              waitLoopComplete = true;
            }
          }
          
          if (missingDivaIds.length === 0) {
            // All stations now in cache
            const combinedResponse: MonitorApiResponse = {
              data: {
                monitors: cachedMonitors
              },
              message: {
                value: 'All data retrieved from cache while waiting',
                messageCode: 1,
                serverTime: new Date().toISOString()
              },
              timestamp: Date.now()
            };
            return res.status(200).json(combinedResponse);
          }
        }
      }
      
      // If we still have missing stations, proceed with API call
      console.log(`After waiting, still missing stations: ${missingDivaIds.join(', ')}. Making our own API call.`);
    } else {
      // We've acquired the lock, let's inform others
      await redis.set(FETCHING_STATUS_KEY, JSON.stringify({
        status: 'fetching',
        timestamp: Date.now()
      }), { ex: 10 }); // 10 second expiry as safety measure
    }
    
    // Update the last request time in Redis
    await redis.set(LAST_REQUEST_KEY, currentTime.toString());
    
    // If we've acquired the lock, check for pending requests to fetch
    let divasToFetch = [...missingDivaIds];
    const fetchedDivaIds = new Set<string>();
    
    if (lockAcquired) {
      // Get all pending DIVAs sorted by timestamp (oldest first)
      // This ensures first-come, first-serve ordering
      const pendingDivaIdsWithScores = await redis.zrange(
        PENDING_DIVA_REQUESTS_KEY,
        0,          // Start index (lowest score = oldest)
        -1,         // End index (get all)
        { withScores: true }  // Get timestamps too
      );
      
      // Process the entries from Redis
      const pendingDivaIds: string[] = [];
      
      // Handle response from Redis zrange
      if (Array.isArray(pendingDivaIdsWithScores)) {
        for (let i = 0; i < pendingDivaIdsWithScores.length; i++) {
          const entry = pendingDivaIdsWithScores[i];
          if (typeof entry === 'string') {
            pendingDivaIds.push(entry);
          }
        }
      }
      
      // Combine with my own missing DIVAs
      const allDivasToFetch = new Set([...missingDivaIds]);
      
      // Add pending DIVAs in timestamp order
      for (const divaId of pendingDivaIds) {
        allDivasToFetch.add(divaId);
      }
      
      divasToFetch = [...allDivasToFetch];
      
      console.log(`As lock winner, fetching ${divasToFetch.length} DIVAs in order of request age:`, 
        divasToFetch.length <= 10 ? divasToFetch.join(', ') : divasToFetch.length + ' DIVAs');
    }
    
    // Make actual API call to Wiener Linien
    const apiResponse = await fetchFromWienerLinien(divasToFetch);
    
    // Add monitors from API response to cachedMonitors
    if (apiResponse.data?.monitors && Array.isArray(apiResponse.data.monitors)) {
      // Add the processed monitors to our cachedMonitors array
      cachedMonitors.push(...apiResponse.data.monitors);
      console.log(`[API Handler] Processing ${apiResponse.data.monitors.length} monitors from API response`);
      
      // Debug monitors to see the structure
      if (apiResponse.data.monitors.length > 0) {
        const sampleMonitor = apiResponse.data.monitors[0];
        console.log(`[API Handler] Sample monitor structure:`, 
          JSON.stringify({
            keys: Object.keys(sampleMonitor),
            locationStopKeys: sampleMonitor.locationStop ? Object.keys(sampleMonitor.locationStop) : [],
            // Check for properties.name which contains the DIVA ID
            hasDivaName: !!sampleMonitor.locationStop?.properties?.name,
            divaNameValue: sampleMonitor.locationStop?.properties?.name,
            hasLines: !!sampleMonitor.lines,
            lineCount: sampleMonitor.lines?.length || 0,
            firstLineKeys: sampleMonitor.lines?.[0] ? Object.keys(sampleMonitor.lines[0]) : [],
            hasDepartures: !!(sampleMonitor.lines?.[0]?.departures),
            departureKeys: sampleMonitor.lines?.[0]?.departures ? Object.keys(sampleMonitor.lines[0].departures) : [],
            departureCount: sampleMonitor.lines?.[0]?.departures?.departure?.length || 0
          }));
      }
      
      for (const monitor of apiResponse.data.monitors) {
        const divaId = extractDivaFromMonitor(monitor);
        
        if (divaId) {
          console.log(`[API Handler] Processing monitor for DIVA ${divaId}:`, 
            monitor.lines ? `${monitor.lines.length} lines found` : 'No lines found');
          
          // Check if the monitor has departures
          let departureCount = 0;
          if (monitor.lines && Array.isArray(monitor.lines)) {
            for (const line of monitor.lines) {
              if (line?.departures?.departure && Array.isArray(line.departures.departure)) {
                departureCount += line.departures.departure.length;
              }
            }
          }
        } else {
          console.log(`Some stations weren't fetched: ${missingDivaIds.join(', ')}`);
          // They remain in the queue for the next instance
        }
      }
            
      // Also check cache directly in case status reporting failed
      let allFound = true;
      for (const divaId of [...missingDivaIds]) {
        const stationCacheKey = `monitor:station:${divaId}`;
        const cachedStation = await redis.get(stationCacheKey);
              
        if (cachedStation) {
          // Check if this DIVA ID is already included in the cachedMonitors array
          const stationDivaId = extractDivaFromMonitor(cachedStation);
          const stationAlreadyIncluded = cachedMonitors.some(existingMonitor => {
            const existingDivaId = extractDivaFromMonitor(existingMonitor);
            return existingDivaId === stationDivaId;
          });
          
          // Only add if not already included
          if (!stationAlreadyIncluded && stationDivaId) {
            console.log(`[API Handler] Adding cached station with DIVA ID: ${stationDivaId}`);
            cachedMonitors.push(cachedStation);
          } else if (stationAlreadyIncluded) {
            console.log(`[API Handler] Skipping duplicate station with DIVA ID: ${stationDivaId}`);
          }
          
          missingDivaIds.splice(missingDivaIds.indexOf(divaId), 1);
        } else {
          allFound = false;
        }
      }
            
      if (allFound) {
        // All stations were found in cache, continue processing
        console.log('All stations found in cache');
      }
    }
    
    // Count total departures across all monitors
    let totalDepartures = 0;
    console.log(`[API Handler] Cached monitors count for response: ${cachedMonitors.length}`);
    for (const monitor of cachedMonitors) {
      if (monitor?.lines && Array.isArray(monitor.lines)) {
        console.log(`[API Handler] Monitor has ${monitor.lines.length} lines`);
        for (const line of monitor.lines) {
          if (line?.departures?.departure && Array.isArray(line.departures.departure)) {
            totalDepartures += line.departures.departure.length;
          }
        }
      }
    }

    // Group monitors by station ID
    const groupedByStation = new Map<string, any>();
    
    for (const monitor of cachedMonitors) {
      const stationId = monitor.locationStop?.properties?.name;
      if (!stationId) {
        console.warn('[API Handler] Monitor found without a station ID (locationStop.properties.name), skipping');
        continue;
      }

      if (!groupedByStation.has(stationId)) {
        // First monitor for this station
        groupedByStation.set(stationId, {
          locationStop: monitor.locationStop,
          lines: [...monitor.lines],
          attributes: monitor.attributes || {}
        });
      } else {
        // Add lines to existing station monitor
        const existingStationMonitor = groupedByStation.get(stationId)!;
        existingStationMonitor.lines.push(...monitor.lines);
      }
    }
    
    // Convert grouped monitors back to array
    const groupedMonitors = Array.from(groupedByStation.values());
    
    // Create a combined response with all monitors
    const combinedResponse: MonitorApiResponse = {
      data: {
        monitors: groupedMonitors
      },
      message: {
        value: groupedMonitors.length === normalizedDivaIds.length 
          ? `Complete data retrieved with ${totalDepartures} departures` 
          : `Partial data retrieved with ${totalDepartures} departures`,
        messageCode: 1,
        serverTime: new Date().toISOString()
      },
      timestamp: Date.now()
    };
    
    // Add detailed logging of the response we're sending back
    console.log('[API Handler] Final response structure:', 
      JSON.stringify({
        monitorCount: combinedResponse.data?.monitors?.length || 0,
        departureCount: totalDepartures,
        timestamp: new Date(combinedResponse.timestamp || Date.now()).toLocaleTimeString()
      }));
    
    // Release the lock
    await redis.del(REQUEST_LOCK_KEY);
    
    return res.status(200).json(combinedResponse);
  } catch (error) {
    console.error('Error in monitor API:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch monitor data',
      errorOccurred: true,
      data: null,
      message: {
        value: String(error),
        messageCode: 0,
        serverTime: new Date().toISOString()
      }
    });
  }
}

async function fetchFromWienerLinien(divaIds: string[]): Promise<MonitorApiResponse> {
  try {
    // Set to track which DIVA IDs we successfully fetched and cached
    const fetchedDivaIds = new Set<string>();
    
    console.log('[API Handler] Fetching from Wiener Linien:', 
      `https://www.wienerlinien.at/ogd_realtime/monitor?${divaIds.map(id => `diva=${id}`).join('&')}`);
    
    // Update the fetching status to indicate we're in progress
    await redis.set(FETCHING_STATUS_KEY, JSON.stringify({
      status: 'fetching',
      requestedDivaIds: divaIds,
      timestamp: Date.now()
    }), { ex: 60 }); // 60 second expiry as safety measure
    
    // Wiener Linien API uses diva parameter
    const url = `https://www.wienerlinien.at/ogd_realtime/monitor?${divaIds.map(id => `diva=${id}`).join('&')}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Wiener Linien API returned ${response.status}`);
    }
    
    // Get the raw response
    const rawData = await response.json();
    
    // Log the API response structure for debugging
    console.log('[API Handler] Raw Wiener Linien API response structure:', 
      JSON.stringify({
        keys: Object.keys(rawData),
        hasData: !!rawData.data,
        dataKeys: rawData.data ? Object.keys(rawData.data) : [],
        hasMonitors: !!(rawData.data?.monitors),
        monitorCount: rawData.data?.monitors?.length || 0
      }));
    
    // Process and validate the data structure
    if (!rawData || !rawData.data || !rawData.data.monitors || !Array.isArray(rawData.data.monitors)) {
      console.warn('[API Handler] Unexpected data structure from Wiener Linien API');
      return {
        data: { monitors: [] },
        message: {
          value: "Invalid data structure received",
          messageCode: 0,
          serverTime: new Date().toISOString()
        },
        errorOccurred: true,
        timestamp: Date.now()
      };
    }
    
    // Count total departures for logging
    let totalDepartures = 0;
    let metroLineCount = 0;
    for (const monitor of rawData.data.monitors) {
      if (monitor.lines && Array.isArray(monitor.lines)) {
        for (const line of monitor.lines) {
          if (['U1', 'U2', 'U3', 'U4', 'U6'].includes(line.name)) {
            metroLineCount++;
          }
          if (line.departures && line.departures.departure && Array.isArray(line.departures.departure)) {
            totalDepartures += line.departures.departure.length;
          }
        }
      }
    }
    
    console.log(`[API Handler] Successfully fetched ${rawData.data.monitors.length} monitors with ${totalDepartures} total departures (${metroLineCount} metro lines)`);
    
    // Define types for the monitors and lines
    
    // Apply filtering logic to match getWienerLinienMonitor.ts
    const allowedLineNames = ['U1', 'U2', 'U3', 'U4', 'U6'];
    
    // First, filter and limit departures per line
    let processedMonitors: any[] = [];
    if (rawData && rawData.data && rawData.data.monitors && Array.isArray(rawData.data.monitors)) {
      // Step 1: Process each monitor individually (filter lines, limit departures)
      processedMonitors = rawData.data.monitors.map((monitor: any) => {
        let linesWithLimitedDepartures: any[] = [];
        if (monitor.lines && Array.isArray(monitor.lines)) {
          linesWithLimitedDepartures = monitor.lines
            .filter((line: any) => allowedLineNames.includes(line.name))
            .map((line: any) => {
              let updatedDeparturesData = line.departures;
              if (line.departures && line.departures.departure && Array.isArray(line.departures.departure)) {
                updatedDeparturesData = {
                  ...line.departures,
                  departure: line.departures.departure.slice(0, 3)
                };
                console.log('Updated departures data:', JSON.stringify(updatedDeparturesData, null, 2));
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
      }).filter((monitor: any) => monitor.lines && monitor.lines.length > 0);

      console.log('Processed monitors:', JSON.stringify(processedMonitors, null, 2));

      // Step 2: Group monitors by station ID (diva)
      const groupedByStation = new Map<string, Monitor>();
      
      for (const monitor of processedMonitors) {
        const stationId = monitor.locationStop?.properties?.name; // e.g., "60200500"
        if (!stationId) {
          console.warn('[API Handler] Monitor found without a station ID (locationStop.properties.name), skipping:', monitor);
          continue;
        }

        if (!groupedByStation.has(stationId)) {
          // If this is the first time we see this station, initialize it
          groupedByStation.set(stationId, {
            locationStop: monitor.locationStop,
            lines: [...monitor.lines],
            attributes: monitor.attributes || {}
          });
        } else {
          // If station already exists, append lines from the current monitor
          const existingStationMonitor = groupedByStation.get(stationId)!;
          existingStationMonitor.lines.push(...monitor.lines);
        }
      }
      
      // Use the grouped monitors for the response
      processedMonitors = Array.from(groupedByStation.values());

      // Cache each individual station monitor by DIVA ID
      // This is the missing piece that allows individual station caching
      for (const [stationId, monitor] of groupedByStation.entries()) {
        const stationCacheKey = `monitor:station:${stationId}`;
        console.log(`[API Handler] Caching station data for DIVA ${stationId}`);
        await redis.set(stationCacheKey, monitor, { ex: 60 }); // Cache for 60 seconds
        
        // Add this DIVA ID to our set of fetched DIVAs
        fetchedDivaIds.add(stationId);
      }
    }
    
    // Update the fetching status to indicate completion
    await redis.set(FETCHING_STATUS_KEY, JSON.stringify({
      status: 'done',
      fetchedDivaIds: Array.from(fetchedDivaIds),
      timestamp: Date.now()
    }), { ex: 10 }); // 10 second expiry as safety measure
    
    console.log(`[API Handler] After filtering: ${processedMonitors.length} monitors with metro lines`);
    
    return {
      data: { monitors: processedMonitors },
      message: rawData.message || {
        value: "OK",
        messageCode: 1,
        serverTime: new Date().toISOString()
      },
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error fetching from Wiener Linien:', error);
    throw error;
  }
}

// Using 'any' type for locationStop properties to avoid TypeScript errors with the API response structure
interface MonitorWithAnyProperties {
  locationStop?: {
    properties?: {
      name?: string;
      title?: string;
      attributes?: {
        rbl?: string | number;
      };
    };
    name?: string;
    additionalInfo?: {
      attributes?: {
        rbl?: string | number;
      };
    };
  };
  lines?: any[];
}

function extractDivaFromMonitor(monitor: MonitorWithAnyProperties): string | null {
  try {
    // Based on the sample JSON files, the DIVA identifier is stored in locationStop.properties.name
    if (monitor?.locationStop?.properties?.name) {
      console.log(`[API Handler] Found DIVA ID in properties.name: ${monitor.locationStop.properties.name}`);
      return monitor.locationStop.properties.name.toString();
    }
    
    // Alternative locations to check if the primary method fails
    if (monitor?.locationStop?.name) {
      return monitor.locationStop.name.toString();
    }
    
    // Sometimes the RBL field is used instead
    if (monitor?.locationStop?.properties?.attributes?.rbl) {
      return monitor.locationStop.properties.attributes.rbl.toString();
    }
    
    if (monitor?.locationStop?.additionalInfo?.attributes?.rbl) {
      return monitor.locationStop.additionalInfo.attributes.rbl.toString();
    }
    
    // Log structured information about the monitor to help diagnose issues
    console.log('[API Handler] Could not extract DIVA from monitor:', 
      JSON.stringify({
        hasLocationStop: !!monitor?.locationStop,
        locationStopKeys: monitor?.locationStop ? Object.keys(monitor.locationStop) : [],
        hasProperties: !!monitor?.locationStop?.properties,
        propertiesKeys: monitor?.locationStop?.properties ? Object.keys(monitor.locationStop.properties) : [],
        stationName: monitor?.locationStop?.properties?.title || 'unknown'
      }));
    
    return null;
  } catch (error) {
    console.warn('Error extracting DIVA from monitor:', error);
    return null;
  }
}
