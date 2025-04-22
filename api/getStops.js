import { createClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";
import wkx from "wkx";

export default async function handler(req, res) {
  // Supabase-Client initialisieren
  const supabase = createClient(
    dotenvx.get("SUPABASE_URL"),
    dotenvx.get("SUPABASE_ANON_KEY")
  );

  const {haltestellen_ids, linien_id} = req.query;

  // Standardmäßig alle Haltestellen abfragen
  let stationIds = [];

  // Wenn linien_id angegeben wurde, hole alle Haltestellen dieser Linie
  if (linien_id) {
    try {
      // Abfrage aller Haltestellen einer bestimmten Linie über die steige-Tabelle
      const { data: steigeData, error: steigeError } = await supabase
        .from("steige")
        .select("fk_haltestellen_id")
        .eq("fk_linien_id", linien_id)
        .eq("richtung", "H")
        .order("reihenfolge", { ascending: true });

      console.log(JSON.stringify(steigeData, null, 2));

      if (steigeError) throw steigeError;

      // Eindeutige Haltestellen-IDs extrahieren
      if (steigeData && steigeData.length > 0) {
        stationIds = [...new Set(steigeData.map(steig => steig.fk_haltestellen_id))];
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  // Wenn keine haltestellenIds angegeben wurden, hole Haltestellen der Metro-Linien
  else if (!haltestellen_ids) {
    try {
      // Join-Abfrage: linien → steige mit Filter für Metro-Linien
      const { data: steigeData, error: joinError } = await supabase
        .from("steige")
        .select("fk_haltestellen_id, linien!inner(verkehrsmittel)")
        .eq("linien.verkehrsmittel", "ptMetro")
        .order("reihenfolge", { ascending: true })
        .order("richtung", { ascending: true });

      if (joinError) throw joinError;

      // Eindeutige Haltestellen-IDs extrahieren
      if (steigeData && steigeData.length > 0) {
        stationIds = [...new Set(steigeData.map(steig => steig.fk_haltestellen_id))];
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
  // Filterung nach haltestellenIds falls vorhanden
  else {
    // Verarbeitung sowohl als Array als auch als String-Format
    stationIds = Array.isArray(haltestellen_ids)
      ? haltestellen_ids
      : haltestellen_ids.split(',').map(id => id.trim());
  }

  // Daten abrufen mit Filterung nach IDs, wenn vorhanden
  let query = supabase.from("haltestellen").select("*");

  if (stationIds.length > 0) {
    query = query.in('haltestellen_id', stationIds);
  }

  const { data, error } = await query;

  // Fehlerbehandlung
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Alle Metro-linien_ids für die gefundenen Haltestellen abrufen
  const stopLineMap = {};
  if (data && data.length > 0) {
    const stopIds = data.map(stop => stop.haltestellen_id);

    // Abfrage der steige-Tabelle für die gefundenen Haltestellen mit Join zu linien für Metro-Filter
    const { data: steigeData, error: steigeError } = await supabase
      .from("steige")
      .select("fk_haltestellen_id, fk_linien_id, linien!inner(verkehrsmittel)")
      .in("fk_haltestellen_id", stopIds)
      .eq("linien.verkehrsmittel", "ptMetro")
      .order("reihenfolge", { ascending: true })
      .order("richtung", { ascending: true });

    if (steigeError) {
      return res.status(500).json({ error: steigeError.message });
    }

    // Gruppieren der Metro-Linien-IDs nach Haltestellen-ID
    steigeData.forEach(steige => {
      if (!stopLineMap[steige.fk_haltestellen_id]) {
        stopLineMap[steige.fk_haltestellen_id] = [];
      }
      stopLineMap[steige.fk_haltestellen_id].push(steige.fk_linien_id);
    });
  }

  // Sortieren der Daten nach der Reihenfolge der stationIds
  const sortedData = [];
  if (stationIds.length > 0) {
    // Für jeden stationId in der ursprünglichen Reihenfolge
    stationIds.forEach(id => {
      // Suche das entsprechende Haltestellen-Objekt
      const matchingStop = data.find(item => item.haltestellen_id === id);
      if (matchingStop) {
        sortedData.push(matchingStop);
      }
    });
  } else {
    // Falls keine spezifische Sortierung verwendet wird, behalte die ursprüngliche Reihenfolge
    sortedData.push(...data);
  }

  // Konvertiere die Daten in GeoJSON
  const geoJsonData = {
    type: "FeatureCollection",
    features: sortedData.map((halt) => {
      // WKB-String in GeoJSON umwandeln
      const wkbBuffer = Buffer.from(halt.location, "hex");
      const geoJSON = wkx.Geometry.parse(wkbBuffer).toGeoJSON();

      // Linien für diese Haltestelle abrufen (leeres Array falls keine vorhanden)
      const associatedLines = stopLineMap[halt.haltestellen_id] || [];

      return {
        type: "Feature",
        geometry: geoJSON,
        properties: {
          haltestellen_id: halt.haltestellen_id,
          diva: halt.diva,
          name: halt.name,
          linien_ids: associatedLines,
        },
      };
    }),
  };

  // GeoJSON zurückgeben
  return res.status(200).json(geoJsonData);
}
