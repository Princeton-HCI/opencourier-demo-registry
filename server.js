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
  const { metadata, config } = req.body;

  // Basic presence checks only
  if (!metadata || !config) {
    return res.status(400).json({ error: "metadata and config are required" });
  }
  const requiredMetaKeys = [
    "name",
    "link",
    "websocketLink",
    "region",
    "imageUrl",
    "userCount",
  ];
  const missing = requiredMetaKeys.filter(
    (k) => metadata[k] === undefined || metadata[k] === null,
  );
  if (missing.length) {
    return res
      .status(400)
      .json({ error: `Missing metadata fields: ${missing.join(", ")}` });
  }

  try {
    const result = await pool.query(
      `INSERT INTO instances 
       (name, link, websocket_link, region, image_url, user_count, status) 
       VALUES ($1, $2, $3, ST_GeomFromGeoJSON($4), $5, $6, 'pending')
       RETURNING *;`,
      [
        metadata.name,
        metadata.link,
        metadata.websocketLink,
        metadata.region ? JSON.stringify(metadata.region) : null,
        metadata.imageUrl || null,
        metadata.userCount || 0,
      ],
    );

    res.status(201).json({
      message: "Instance registered successfully. Pending verification.",
      instance: result.rows[0],
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
        ST_AsGeoJSON(region) as region,
        image_url,
        user_count,
        status,
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
      region: row.region ? JSON.parse(row.region) : null,
      imageUrl: row.image_url,
      userCount: row.user_count,
      status: row.status,
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
