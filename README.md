# OpenCourier Demo Registry

A demo registry service for OpenCourier that provides efficient instance discovery while maintaining decentralized governance.

## Overview

This registry allows couriers to discover instances and admins to register their instances. It uses PostGIS for geographic data storage and provides REST endpoints for registration and querying.

## Features

- **Instance Registration**: Admins can register their instances via POST `/registrations`
- **Instance Discovery**: Mobile app can fetch verified instances via GET `/instances`
- **Registration Status**: Admins can check status via GET `/registrations?instanceLink=...`
- **Metadata Refresh**: Admins can trigger refresh via POST `/registrations/refresh`
- **Instance Removal**: Admins can remove registrations via DELETE `/registrations?instanceLink=...`
- **Geographic Support**: Uses PostGIS for storing geographic regions
- **Status-based Filtering**: Only verified instances are returned to mobile app
- **Flexible Schema**: Stores all instance metadata with ability to adapt to new attributes

## Minimum Required Data for Demo Registry

The demo registry accepts a POST request with `metadata` and `config` objects, but only stores the minimum required fields as database columns:

**Metadata Fields Stored in Database:**

- `name` - Instance name
- `link` - Unique instance URL (cannot be changed after registration)
- `websocketLink` - WebSocket endpoint for the instance
- `region` - Geographic region (GeoJSON FeatureCollection)
- `imageUrl` - Instance logo/image
- `userCount` - Number of users on instance

**Other Metadata Fields (not stored):**

- `rulesUrl`, `descriptionUrl`, `termsOfServiceUrl`, `privacyPolicyUrl`

**Config (received but not stored):**
The config object is received but not persisted in the database. Basic presence is expected; instances manage their own configuration.

## Setup

### Prerequisites

- Node.js 14+
- PostgreSQL 12+ with PostGIS extension
- Render account (for hosting)

### Local Development

1. **Clone and install**

```bash
yarn install
# or
npm install
```

2. **Set up environment**

   ```bash
   cp .env.example .env
   # Edit .env with your database connection string
   ```

3. **Initialize database**

```bash
yarn db:setup
# or
npm run db:setup
```

4. **Run development server**

```bash
yarn dev
# or
npm run dev
```

5. **Run production server**

```bash
yarn start
# or
npm start
```

## API Endpoints

### POST /registrations

Register a new instance. The registry accepts full payloads and stores the raw body for auditing, but only filters out the minimum columns it needs for discovery. Send everything you have; the registry will do the filtering.

**Request:**

```json
{
  "metadata": {
    "name": "Downtown Delivery",
    "link": "https://downtown-delivery.com",
    "websocketLink": "wss://downtown-delivery.com/ws",
    "region": {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "geometry": {
            "type": "Point",
            "coordinates": [-74.006, 40.7128]
          }
        }
      ]
    },
    "imageUrl": "https://downtown-delivery.com/logo.png",
    "userCount": 150,
    "rulesUrl": "https://downtown-delivery.com/rules",
    "descriptionUrl": "https://downtown-delivery.com/description",
    "termsOfServiceUrl": "https://downtown-delivery.com/tos",
    "privacyPolicyUrl": "https://downtown-delivery.com/privacy"
  },
  "config": {
    "courierMatcherType": "distance-based",
    "quoteCalculationType": "dynamic",
    "geoCalculationType": "haversine",
    "deliveryDurationCalculationType": "historical",
    "courierCompensationCalculationType": "base-plus-distance",
    "maxAssignmentDistance": 5000,
    "maxDriftDistance": 500,
    "quoteExpirationMinutes": 30,
    "feePercentageAmount": 15,
    "defaultCourierPayRate": 0.5,
    "defaultMinimumCourierPay": 5.0,
    "defaultMaxWorkingHours": 8,
    "defaultDietaryRestrictions": ["vegetarian"],
    "distanceUnit": "meters",
    "currency": "USD"
  }
}
```

**Response:** `201 Created`

```json
{
  "message": "Instance registered and verified successfully.",
  "instance": { ... }
}
```

### GET /instances

Fetch all verified instances (demo registry returns minimum required fields only)

**Response:** `200 OK`

```json
{
  "instances": [
    {
      "id": 1,
      "name": "Downtown Delivery",
      "link": "https://downtown-delivery.com",
      "websocketLink": "wss://downtown-delivery.com/ws",
      "region": { ... },
      "imageUrl": "https://downtown-delivery.com/logo.png",
      "userCount": 150,
      "status": "verified"
    }
  ],
  "count": 1
}
```

### GET /registrations

Fetch a registration status by instance link.

**Query parameter:**

- `instanceLink` (required): Exact instance `link` value to look up.

**Request:** `GET /registrations?instanceLink=https://downtown-delivery.com`

**Response:** `200 OK`

```json
{
  "instanceLink": "https://downtown-delivery.com",
  "status": "verified",
  "reason": null,
  "createdAt": "2024-01-01T12:00:00.000Z",
  "lastFetchedAt": "2024-01-01T12:05:00.000Z"
}
```

### POST /registrations/refresh

Trigger a metadata refresh for a specific instance (async).

**Request body:**

```json
{
  "instanceLink": "https://downtown-delivery.com"
}
```

**Response:** `202 Accepted`

```json
{
  "message": "Metadata refresh triggered"
}
```

### DELETE /registrations

Delete a registration by instance link.

**Query parameter:**

- `instanceLink` (required): Exact instance `link` value to delete.

**Request:** `DELETE /registrations?instanceLink=https://downtown-delivery.com`

**Response:** `200 OK`

```json
{
  "message": "Instance registration deleted"
}
```

If the instance does not exist, the endpoint returns `404`.

## Database Schema

The `instances` table stores minimum requirements for efficient mobile app queries:

- `id` - Primary key
- `name` - Instance name
- `link` - Unique instance URL
- `websocket_link` - WebSocket endpoint
- `region` - PostGIS geometry for geographic queries
- `image_url` - Instance logo/image
- `user_count` - Number of users on instance
- `status` - 'pending' or 'verified' (only verified shown to mobile)
- `created_at` - When instance was registered
- `updated_at` - When instance data was last modified
- `last_fetched_at` - When registry last fetched fresh data from instance's `/metadata` endpoint (tracks data staleness)

## Deployment to Render

### Database Setup

1. Create a PostgreSQL database on Render
2. Enable PostGIS extension
3. Save your `DATABASE_URL`

### API Deployment

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Set environment variable `DATABASE_URL`
4. Set build command: `yarn install` (or `npm install`)
5. Set start command: `yarn start` (or `npm start`)

### Getting Your Registry Link

Once deployed on Render, your registry link will be:

```
https://your-render-service-name.onrender.com
```

Admins can then:

- Register via: `POST https://your-render-service-name.onrender.com/registrations`
- Mobile app queries: `GET https://your-render-service-name.onrender.com/instances`
- Remove a registration: `DELETE https://your-render-service-name.onrender.com/registrations?instanceLink=...`

## Curation (Future)

- Currently all registrations are pending (require manual approval)
- Future: Implement automatic verification based on domain verification
- Future: Add endpoints for admin panel to approve/reject registrations

## Notes

- Instance links cannot be changed after registration to prevent registry query failures
- The registry validates registrations by fetching the instance `/metadata` endpoint
- All instance metadata is public for transparency
- Flexible schema allows registries to add custom attributes as needed
