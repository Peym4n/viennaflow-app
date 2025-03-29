import { createClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";
import wkx from "wkx";

export default async function handler(req, res) {
  // Query-Parameter auslesen
  //example call http://localhost:4200/api/getsteige?stopid=1085613576
  const { stopid } = req.query;

  if (!stopid) {
    return res.status(400).json({ error: "stopid ist mandatory" });
  }

  // Supabase-Client initialisieren
  const supabase = createClient(
    dotenvx.get("SUPABASE_URL"),
    dotenvx.get("SUPABASE_ANON_KEY")
  );

  // Abfrage der Tabelle "steige" mit Filter auf stopid
  const { data, error } = await supabase
    .from("steige")
    .select("*")
    .eq("fk_haltestellen_id", stopid); // Filter setzen

  // Fehlerbehandlung
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Konvertiere die Daten in GeoJSON
  const geoJsonData = {
    type: "FeatureCollection",
    features: data.map((steige) => {
      // WKB-String in GeoJSON umwandeln
      const wkbBuffer = Buffer.from(steige.location, "hex");
      const geoJSON = wkx.Geometry.parse(wkbBuffer).toGeoJSON();

      return {
        type: "Feature",
        geometry: geoJSON,
        properties: {
          steig_id: steige.steig_id,
          fk_linien_id: steige.fk_linien_id,
          fk_haltestellen_id: steige.fk_haltestellen_id,
          richtung: steige.richtung, //direction
          reihenfolge: steige.reihenfolge,
          rbl_nummer: steige.rbl_nummer,
          bereich: steige.bereich,
          steig: steige.steig,
        },
      };
    }),
  };

  // Daten als JSON zurückgeben
  res.status(200).json(data);
}
