import { readFileSync } from 'fs';
import { join } from 'path';

export default function handler(req, res) {
  try {
    // Extrahiere die Query-Parameter
    const { linien_id } = req.query;
    
    // Pfad zur JSON-Datei relativ zum API-Verzeichnis
    const filePath = join(process.cwd(), 'api', 'lineStops.json');
    
    // Lese die JSON-Datei
    const jsonData = JSON.parse(readFileSync(filePath, 'utf8'));
    
    // Wenn keine linien_id angegeben wurde, gib alle Linien zurück
    if (!linien_id) {
      // Metadaten beibehalten und alle Linien zurückgeben
      return res.status(200).json(jsonData);
    }
    
    // Unterstützung für mehrere Linien-IDs, durch Komma getrennt
    const linienIds = linien_id.split(',');
    
    // Filtere die Linien nach den angegebenen IDs
    const filteredLines = {};
    
    // Füge jede angeforderte Linie hinzu, falls sie existiert
    linienIds.forEach(id => {
      if (jsonData.lines[id]) {
        filteredLines[id] = jsonData.lines[id];
      }
    });
    
    // Erstelle eine neue Antwort mit den Metadaten und gefilterten Linien
    const response = {
      metainfo: jsonData.metainfo,
      lines: filteredLines
    };
    
    // Sende die Antwort
    res.status(200).json(response);
  } catch (error) {
    console.error('Fehler beim Abrufen der Linienhaltestellen:', error);
    res.status(500).json({ 
      error: 'Beim Abrufen der Linienhaltestellen ist ein Fehler aufgetreten',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
