import { NextRequest, NextResponse } from "next/server";

// Mexico region bounding box for demo
const MEXICO_BBOX = {
  minlatitude: 14.0,
  maxlatitude: 33.0,
  minlongitude: -118.0,
  maxlongitude: -86.0,
};

// GET /api/usgs-events?minMag=6.0&limit=25
// Returns significant historical + recent earthquakes in/near Mexico.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const minMag = searchParams.get("minMag") || "6.5";
    const limit = searchParams.get("limit") || "25";
    const starttime = searchParams.get("starttime") || "1985-01-01";

    const url =
      "https://earthquake.usgs.gov/fdsnws/event/1/query" +
      `?format=geojson` +
      `&starttime=${encodeURIComponent(starttime)}` +
      `&minmagnitude=${encodeURIComponent(minMag)}` +
      `&orderby=magnitude` +
      `&limit=${encodeURIComponent(limit)}` +
      `&minlatitude=${MEXICO_BBOX.minlatitude}` +
      `&maxlatitude=${MEXICO_BBOX.maxlatitude}` +
      `&minlongitude=${MEXICO_BBOX.minlongitude}` +
      `&maxlongitude=${MEXICO_BBOX.maxlongitude}`;

    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`USGS API error: ${res.status}`);
    }

    const data = await res.json();

    const events =
      data.features?.map((f: any) => ({
        id: f.id,
        title: f.properties.title,
        mag: f.properties.mag,
        time: f.properties.time,
        depthKm: f.geometry.coordinates[2],
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      })) || [];

    return NextResponse.json({ ok: true, events });
  } catch (err: any) {
    console.error("USGS fetch error", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          err.message ||
          "Failed to fetch USGS Mexico events",
      },
      { status: 500 }
    );
  }
}
