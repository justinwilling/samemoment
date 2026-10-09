import React, { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
const cache = new Map();
export default function PlaceSearch({ onSelect }) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  async function search(event) {
    event.preventDefault();
    const text = query.trim();
    if (text.length < 2) {
      setMessage("Bitte mindestens zwei Zeichen eingeben.");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setResults([]);
    setMessage("");
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      let places = cache.get(text.toLocaleLowerCase());
      if (!places) {
        const url = new URL(
          import.meta.env.VITE_GEOCODER_URL || "https://photon.komoot.io/api/",
        );
        url.search = new URLSearchParams({
          q: text,
          lang: "de",
          limit: "5",
        }).toString();
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok)
          throw Error("Suche derzeit nicht verfügbar. Bitte erneut versuchen.");
        const data = await response.json();
        places = (data.features || []).flatMap((feature) => {
          const [lng, lat] = feature.geometry?.coordinates || [];
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
          )
            return [];
          const p = feature.properties || {};
          const street = [p.street, p.housenumber].filter(Boolean).join(" ");
          const label = [
            ...new Set(
              [p.name, street, p.postcode, p.city, p.state, p.country].filter(
                Boolean,
              ),
            ),
          ].join(", ");
          return label ? [{ label, position: [lat, lng] }] : [];
        });
        if (cache.size >= 50) cache.delete(cache.keys().next().value);
        cache.set(text.toLocaleLowerCase(), places);
      }
      if (request.current !== controller) return;
      setResults(places);
      setMessage(
        places.length
          ? ""
          : "Kein Ort gefunden. Versuche einen anderen Namen oder ergänze das Land.",
      );
    } catch (error) {
      if (request.current === controller)
        setMessage(
          error.name === "AbortError"
            ? "Die Suche hat zu lange gedauert. Bitte erneut versuchen."
            : error.message,
        );
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setBusy(false);
    }
  }
  return (
    <div className="placeSearch">
      <form onSubmit={search} role="search" aria-label="Ortssuche">
        <label htmlFor="place-query">Ort oder Adresse suchen</label>
        <div className="placeSearchRow">
          <input
            id="place-query"
            type="search"
            placeholder="z. B. Berlin, Alexanderplatz"
            maxLength={180}
            value={query}
            onChange={(event) => {
              request.current?.abort();
              request.current = null;
              setBusy(false);
              setQuery(event.target.value);
              setResults([]);
              setMessage("");
            }}
          />
          <button type="submit" disabled={busy} aria-label="Ort suchen">
            <Search size={18} />
          </button>
        </div>
      </form>
      <div role="status" className="hint">
        {busy ? "Orte werden gesucht …" : message}
      </div>
      {results.length > 0 && (
        <ul className="placeResults" aria-label="Gefundene Orte">
          {results.map((place, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => {
                  onSelect(place);
                  setQuery(place.label);
                  setResults([]);
                  setMessage(
                    "Ort ausgewählt. Du kannst den Punkt auf der Karte anpassen.",
                  );
                }}
              >
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="placeCredit">
        Ortssuche:{" "}
        <a href="https://photon.komoot.io" target="_blank" rel="noreferrer">
          Photon
        </a>{" "}
        ·{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap
        </a>
      </p>
    </div>
  );
}
