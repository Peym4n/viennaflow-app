import fs from 'fs';

function closestPointOnSegment(A, B, P) {
    const ax = B[0] - A[0];
    const ay = B[1] - A[1];
    const px = P[0] - A[0];
    const py = P[1] - A[1];
    const dot = px * ax + py * ay;
    const len2 = ax * ax + ay * ay;
    let t = 0;
    if (len2 !== 0) {
        t = Math.max(0, Math.min(1, dot / len2));
    }
    const closestX = A[0] + t * ax;
    const closestY = A[1] + t * ay;
    return [
        closestX,
        closestY
    ];
}

function processMetroData(inputFile, outputFile) {
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

    for (const lineId in data.lines) {
        const line = data.lines[lineId];
        const stops = line.stops.features;
        const lineStrings = line.lineStrings;

        // Process stops (existing code)
        const allSegments = [];
        for (const lineString of lineStrings) {
            const coords = lineString.coordinates;
            for (let i = 1; i < coords.length; i++) {
                allSegments.push([coords[i - 1], coords[i]]);
            }
        }

        for (const stop of stops) {
            const originalCoords = stop.geometry.coordinates;
            let closestPoint = null;
            let minDistSq = Infinity;

            for (const segment of allSegments) {
                const A = segment[0];
                const B = segment[1];
                const closest = closestPointOnSegment(A, B, originalCoords);

                const dx = closest[0] - originalCoords[0];
                const dy = closest[1] - originalCoords[1];
                const distSq = dx * dx + dy * dy;

                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closestPoint = closest;
                }
            }

            if (closestPoint) {
                stop.geometry.coordinates = [
                    Number(closestPoint[0].toFixed(7)),
                    Number(closestPoint[1].toFixed(7))
                ];
            }
        }
    }

    // Custom JSON serialization for lineStrings
    let json = JSON.stringify(data, null, 2);
    
    // Minify lineString objects while keeping other formatting
    json = json.replace(
        /{\s*"type": "LineString",\s*"coordinates": (\[[\s\S]*?\])\s*}/g,
        (match, coords) => `{"type":"LineString","coordinates":${JSON.stringify(JSON.parse(coords))}}`
    );

    fs.writeFileSync(outputFile, json);
}

// Example usage
processMetroData('api\\lineStops.json', 'api\\lineStops.json');