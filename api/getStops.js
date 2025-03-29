import { createClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";
import wkx from "wkx";

export default async function handler(req, res) {
  // Supabase-Client initialisieren
  const supabase = createClient(
    dotenvx.get("SUPABASE_URL"),
    dotenvx.get("SUPABASE_ANON_KEY")
  );

  // Daten abrufen
  const { data, error } = await supabase.from("haltestellen").select("*");

  // Fehlerbehandlung
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Konvertiere die Daten in GeoJSON
  const geoJsonData = {
    type: "FeatureCollection",
    features: data.map((halt) => {
      // WKB-String in GeoJSON umwandeln
      const wkbBuffer = Buffer.from(halt.location, "hex");
      const geoJSON = wkx.Geometry.parse(wkbBuffer).toGeoJSON();

      return {
        type: "Feature",
        geometry: geoJSON,
        properties: {
          haltestellen_id: halt.haltestellen_id,
          typ: halt.typ,
          diva: halt.diva,
          name: halt.name,
          gemeinde: halt.gemeinde,
          gemeinde_id: halt.gemeinde_id,
        },
      };
    }),
  };

  // GeoJSON zurückgeben
  return res.status(200).json(geoJsonData);
}
