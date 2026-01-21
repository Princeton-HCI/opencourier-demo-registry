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

// POST /register - Instance administrator registers their instance
app.post("/register", async (req, res) => {
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

  const regionGeoJson =
    details.region && typeof details.region === "object"
      ? JSON.stringify(details.region)
      : details.region;

  try {
    const result = await pool.query(
      `INSERT INTO instances 
       (name, link, websocket_link, region, image_url, user_count, status, last_fetched_at) 
       VALUES ($1, $2, $3, CASE WHEN $4 IS NULL THEN NULL ELSE ST_GeomFromGeoJSON($4::text) END, $5, $6, 'pending', NOW())
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
      ],
    );

    const row = result.rows[0];

    res.status(201).json({
      message: "Instance registered successfully. Pending verification.",
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
  try {
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
        updated_at
       FROM instances 
       WHERE status = 'verified'
       ORDER BY created_at DESC;`,
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

// Start server
app.listen(PORT, () => {
  console.log(`Registry server running on http://localhost:${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  POST /register - Register instance`);
  console.log(`  GET /instances - Get verified instances`);
});
