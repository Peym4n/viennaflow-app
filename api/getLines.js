import {createClient} from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";

export default async function handler(req, res) {
  // Query-Parameter auslesen
  //example call http://localhost:4200/api/getlines?lineid=1085613576
  const {lineid} = req.query;

  // Supabase-Client initialisieren
  const supabase = createClient(
    dotenvx.get("SUPABASE_URL"),
    dotenvx.get("SUPABASE_ANON_KEY")
  );

  // Abfrage der Tabelle "steige" mit Filter auf stopid
  let query = supabase
    .from("linien")
    .select("*")
    .eq("verkehrsmittel", "ptMetro"); // Filter setzen

  if (lineid) {
    query = query.eq("linien_id", lineid);
  }

  const {data, error} = await query;
  // Fehlerbehandlung
  if (error) {
    return res.status(500).json({error: error.message});
  }

  // Daten als JSON zurückgeben
  res.status(200).json(data);
}
