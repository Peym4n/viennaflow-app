import { createClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";

export default async function handler(req, res) {
  // Query-Parameter auslesen
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

  // Daten als JSON zurückgeben
  res.status(200).json(data);
}
