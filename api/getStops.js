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
  
  try {
    let stationIds = [];

    // Fall 1: Haltestellen einer bestimmten Linie abfragen
    if (linien_id) {
      const { data: steigeData, error: steigeError } = await supabase
        .from("steige")
        .select("fk_haltestellen_id")
        .eq("fk_linien_id", linien_id)
        .eq("richtung", "H")
        .order("reihenfolge", { ascending: true });

      if (steigeError) throw steigeError;
      
      if (steigeData?.length > 0) {
        // Exakte Reihenfolge der Haltestellen beibehalten
        stationIds = steigeData.map(steig => steig.fk_haltestellen_id);
      }
    }
    // Fall 2: Spezifische Haltestellen anhand ihrer IDs abfragen
    else if (haltestellen_ids) {
      stationIds = Array.isArray(haltestellen_ids)
        ? haltestellen_ids
        : haltestellen_ids.split(',').map(id => id.trim());
    }
    // Fall 3: Standardfall - Alle Metro-Haltestellen abfragen
    else {
      const { data: steigeData, error: joinError } = await supabase
        .from("steige")
        .select("fk_haltestellen_id, linien!inner(verkehrsmittel)")
        .eq("linien.verkehrsmittel", "ptMetro");
        // .order("fk_linien_id", { ascending: true })
        // .order("richtung", { ascending: true })
        // .order("reihenfolge", { ascending: true });

      if (joinError) throw joinError;

      if (steigeData?.length > 0) {
        // Duplikate entfernen
        stationIds = [...new Set(steigeData.map(steig => steig.fk_haltestellen_id))];
      }
    }

    // Frühe Rückgabe wenn keine Haltestellen gefunden wurden
    if (stationIds.length === 0) {
      return res.status(200).json({
        type: "FeatureCollection",
        features: []
      });
    }

    // Haltestellen-Daten aus der Datenbank abrufen
    const { data, error } = await supabase
      .from("haltestellen")
      .select("*")
      .in('haltestellen_id', stationIds);

    if (error) throw error;
    
    if (!data?.length) {
      return res.status(200).json({
        type: "FeatureCollection", 
        features: []
      });
    }

    // Metro-Linien für alle gefundenen Haltestellen abrufen
    const stopLineMap = {};
    const { data: steigeData, error: steigeError } = await supabase
      .from("steige")
      .select("fk_haltestellen_id, fk_linien_id, linien!inner(verkehrsmittel)")
      .in("fk_haltestellen_id", stationIds)
      .eq("linien.verkehrsmittel", "ptMetro");

    if (steigeError) throw steigeError;

    // Linien nach Haltestellen gruppieren
    steigeData?.forEach(steige => {
      if (!stopLineMap[steige.fk_haltestellen_id]) {
        stopLineMap[steige.fk_haltestellen_id] = [];
      }
      stopLineMap[steige.fk_haltestellen_id].push(steige.fk_linien_id);
    });

    // Haltestellen-Daten in der Reihenfolge der abgefragten IDs sortieren
    const dataMap = {};
    data.forEach(item => dataMap[item.haltestellen_id] = item);
    
    const sortedData = stationIds
      .map(id => dataMap[id])
      .filter(Boolean);

    // GeoJSON Features aus den sortierten Haltestellen erzeugen
    const features = sortedData.map(halt => {
      // WKB-String in GeoJSON umwandeln
      const wkbBuffer = Buffer.from(halt.location, "hex");
      const geoJSON = wkx.Geometry.parse(wkbBuffer).toGeoJSON();

      return {
        type: "Feature",
        geometry: geoJSON,
        properties: {
          haltestellen_id: halt.haltestellen_id,
          diva: halt.diva,
          name: halt.name,
          linien_ids: stopLineMap[halt.haltestellen_id] || [],
        },
      };
    });

    // GeoJSON zurückgeben
    return res.status(200).json({
      type: "FeatureCollection",
      features
    });
  } catch (error) {
    // Fehlerbehandlung
    console.error("Fehler in getStops API:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
