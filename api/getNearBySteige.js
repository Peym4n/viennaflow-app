// /api/getNearbySteige.js
import { createClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";

export default async function handler(req, res) {
  //.../api/getNearbySteige?lat=48.2082&lon=16.3738&radius=1000

  const { lat, lon, radius } = req.query;
  console.log("gettingNearByStations");

  if (!lat || !lon) {
    return res
      .status(400)
      .json({ error: "Latitude and longitude are required." });
  }

  const supabase = createClient(
    dotenvx.get("SUPABASE_URL"),
    dotenvx.get("SUPABASE_ANON_KEY")
  );

  const { data, error } = await supabase.rpc("get_nearby_steige", {
    lat: parseFloat(lat),
    lon: parseFloat(lon),
    radius: parseInt(radius) || 1000,
  });
  console.log(data);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(data);
}
