require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./src/db");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// POST /registrations - Instance administrator registers their instance
app.post("/registrations", async (req, res) => {
  // Accept any payload shape and filter what we need
  const payload = req.body || {};
  const normalizedDetails =
    payload.details ||
    payload.metadata ||
    payload.instanceDetails ||
    payload.instanceConfig?.details ||
    payload.instance_config?.details ||
    {};

  const normalizedConfig =
    payload.config ||
    payload.configuration ||
    payload.instanceConfiguration ||
    payload.instance_config ||
    payload.instanceConfig ||
    {};

  const details = {
    name: normalizedDetails.name ?? payload.name,
    link: normalizedDetails.link ?? payload.link,
    websocketLink: normalizedDetails.websocketLink ?? payload.websocketLink,
    region: normalizedDetails.region ?? payload.region ?? null,
    imageUrl: normalizedDetails.imageUrl ?? payload.imageUrl ?? null,
    userCount: normalizedDetails.userCount ?? payload.userCount ?? null,
    rulesUrl: normalizedDetails.rulesUrl ?? payload.rulesUrl,
    descriptionUrl: normalizedDetails.descriptionUrl ?? payload.descriptionUrl,
    termsOfServiceUrl:
      normalizedDetails.termsOfServiceUrl ?? payload.termsOfServiceUrl,
    privacyPolicyUrl:
      normalizedDetails.privacyPolicyUrl ?? payload.privacyPolicyUrl,
  };

  const updatedAt = payload.updatedAt ?? null;

  const requiredMetaKeys = [
    "name",
    "link",
    "websocketLink",
    "region",
    "imageUrl",
    "userCount",
  ];
  const missing = requiredMetaKeys.filter(
    (k) => details[k] === undefined || details[k] === null,
  );
  if (missing.length) {
    return res
      .status(400)
      .json({ error: `Missing details fields: ${missing.join(", ")}` });
  }

  // Verify the instance metadata endpoint responds with data before storing
  let metadataUrl;
  try {
    metadataUrl = new URL("/metadata", details.link).toString();
  } catch (err) {
    return res.status(400).json({ error: "Invalid instance link" });
  }

  const metadataController = new AbortController();
  const metadataTimeout = setTimeout(() => metadataController.abort(), 5000);

  try {
    const metadataRes = await fetch(metadataUrl, {
      method: "GET",
      signal: metadataController.signal,
    });

    clearTimeout(metadataTimeout);

    if (!metadataRes.ok) {
      return res.status(400).json({
        error: `Instance metadata unreachable (status ${metadataRes.status})`,
      });
    }

    const metadataBody = await metadataRes.text();
    if (!metadataBody || !metadataBody.trim()) {
      return res
        .status(400)
        .json({ error: "Instance metadata endpoint returned empty response" });
    }
  } catch (error) {
    clearTimeout(metadataTimeout);
    const reason = error.name === "AbortError" ? "timeout" : "fetch failed";
    return res
      .status(400)
      .json({ error: `Failed to verify instance metadata: ${reason}` });
  }

  // Region should already be normalized to a geometry object (Polygon/MultiPolygon) by the client
  const regionGeoJson =
    details.region && typeof details.region === "object"
      ? JSON.stringify(details.region)
      : details.region;

  try {
    const result = await pool.query(
      `INSERT INTO instances 
       (name, link, websocket_link, region, image_url, user_count, status, last_fetched_at, created_at, updated_at) 
       VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN NULL ELSE ST_GeomFromGeoJSON($4::text) END, $5, $6, 'verified', NOW(), NOW(), $7)
       RETURNING 
         id,
         name,
         link,
         websocket_link,
         ST_AsGeoJSON(region) AS region_geojson,
         image_url,
         user_count,
         status,
         last_fetched_at,
         created_at,
         updated_at;`,
      [
        details.name,
        details.link,
        details.websocketLink,
        regionGeoJson,
        details.imageUrl || null,
        details.userCount || 0,
        updatedAt,
      ],
    );

    const row = result.rows[0];

    res.status(201).json({
      message: "Instance registered and verified successfully.",
      instance: {
        id: row.id,
        name: row.name,
        link: row.link,
        websocketLink: row.websocket_link,
        region: row.region_geojson ? JSON.parse(row.region_geojson) : null,
        imageUrl: row.image_url,
        userCount: row.user_count,
        status: row.status,
        lastFetchedAt: row.last_fetched_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Instance with this link already exists",
      });
    }
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /instances - Fetch list of verified instances for mobile app
app.get("/instances", async (req, res) => {
  const { lat, lng } = req.query;

  // Default coordinates: Princeton, NJ
  const DEFAULT_LAT = 40.344;
  const DEFAULT_LNG = -74.6514;

  // Use provided coordinates or fall back to default
  let latitude, longitude;

  if (lat !== undefined && lng !== undefined) {
    latitude = parseFloat(lat);
    longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: "Invalid latitude or longitude" });
    }
  } else {
    latitude = DEFAULT_LAT;
    longitude = DEFAULT_LNG;
  }

  try {
    // Always sort by distance from coordinates (provided or default)
    const result = await pool.query(
      `SELECT 
        id,
        name,
        link,
        websocket_link,
        ST_AsGeoJSON(region) AS region_geojson,
        image_url,
        user_count,
        status,
        last_fetched_at,
        created_at,
        updated_at,
        ST_Distance(
          region::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distance_meters
       FROM instances 
       WHERE status = 'verified'
       ORDER BY distance_meters ASC NULLS LAST;`,
      [longitude, latitude],
    );

    // Format response with camelCase for frontend
    const instances = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      link: row.link,
      websocketLink: row.websocket_link,
      region: row.region_geojson ? JSON.parse(row.region_geojson) : null,
      imageUrl: row.image_url,
      userCount: row.user_count,
      status: row.status,
      lastFetchedAt: row.last_fetched_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      distanceMeters: row.distance_meters,
    }));

    res.json({
      instances,
      count: instances.length,
    });
  } catch (error) {
    console.error("Fetch instances error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /registrations - Fetch registration status for admin dashboard
app.get("/registrations", async (req, res) => {
  const { instanceLink } = req.query;

  if (!instanceLink) {
    return res
      .status(400)
      .json({ error: "instanceLink query parameter is required" });
  }

  try {
    const result = await pool.query(
      `SELECT 
        link,
        status,
        last_fetched_at,
        created_at
       FROM instances 
       WHERE link = $1
       LIMIT 1;`,
      [instanceLink],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Instance not found" });
    }

    const row = result.rows[0];

    res.json({
      instanceLink: row.link,
      status: row.status,
      reason: null,
      createdAt: row.created_at,
      lastFetchedAt: row.last_fetched_at,
    });
  } catch (error) {
    console.error("Fetch registration status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /registrations - Remove an instance registration
app.delete("/registrations", async (req, res) => {
  const instanceLink = req.query.instancelink || req.query.instanceLink;

  if (!instanceLink) {
    return res
      .status(400)
      .json({ error: "instanceLink query parameter is required" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM instances WHERE link = $1 RETURNING id;",
      [instanceLink],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Instance not found" });
    }

    res.json({ message: "Instance registration deleted" });
  } catch (error) {
    console.error("Delete registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Registry server running on http://localhost:${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  POST /registrations - Register instance`);
  console.log(`  GET /instances - Get verified instances`);
  console.log(`  GET /registrations - Get registration status`);
  console.log(`  DELETE /registrations - Remove instance registration`);
});
