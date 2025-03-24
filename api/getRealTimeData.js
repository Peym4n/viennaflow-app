import { createClient } from "@supabase/supabase-js";
import * as dotenvx from "@dotenvx/dotenvx";
import axios from "axios";

export default async function handler(req, res) {
  const { rbl } = req.query;

  if (!rbl) {
    return res.status(400).json({ error: "rbl number ist mandatory" });
  }

  try {
    const { data } = await axios.get(
      `https://www.wienerlinien.at/ogd_realtime/monitor?rbl=${rbl}`
    );

    console.log(data);

    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching data:", error);
    return res.status(400).json({ error: "Data not found" });
  }
}
