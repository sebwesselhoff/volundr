/**
 * packs.ts — Pack installation API
 *
 * Provides endpoints for querying available packs and recording pack
 * installation state in the DB.
 *
 * Packs live on disk at framework/packs/{name}/pack.json.  This route
 * does not modify the framework files — it seeds DB records (personas,
 * events) based on pack metadata provided in the request body.
 */

import { Router } from 'express';
import { getDb, schema } from '@vldr/db';
import { eq } from 'drizzle-orm';
import { ApiError } from '../middleware/error-handler.js';
import { broadcastToAll } from '../ws/broadcast.js';

const router = Router();

export interface PackManifest {
  name: string;
  version: string;
  description: string;
  alwaysLoad: boolean;
  agentTypes: string[];
  signals: string[];
}

export interface InstallPackInput {
  projectId: string;
  /** Pack manifest (read from framework/packs/{name}/pack.json by the caller) */
  manifest: PackManifest;
  /** Persona seed records to register for this pack */
  personas?: Array<{
    id: string;
    name: string;
    role: string;
    expertise: string;
    style?: string;
    modelPreference?: string;
  }>;
}

export interface InstallPackResult {
  pack: string;
  version: string;
  personasRegistered: string[];
  personasSkipped: string[];
  agentTypesActivated: string[];
}

// POST /api/packs/install — record a pack installation in the DB
router.post('/packs/install', (req, res) => {
  const body = req.body as InstallPackInput;
  if (!body.projectId) throw new ApiError(400, 'projectId is required');
  if (!body.manifest?.name) throw new ApiError(400, 'manifest.name is required');

  const db = getDb();
  const { projectId, manifest, personas: personaSeeds = [] } = body;
  const now = new Date().toISOString();

  // Verify project exists
  const [project] = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all();
  if (!project) throw new ApiError(404, `Project '${projectId}' not found`);

  const registered: string[] = [];
  const skipped: string[] = [];

  // Upsert persona seeds
  for (const seed of personaSeeds) {
    const [existing] = db
      .select()
      .from(schema.personas)
      .where(eq(schema.personas.id, seed.id))
      .all();

    if (existing) {
      skipped.push(seed.id);
      continue;
    }

    db.insert(schema.personas)
      .values({
        id: seed.id,
        name: seed.name,
        role: seed.role,
        expertise: seed.expertise,
        style: seed.style ?? '',
        modelPreference: seed.modelPreference ?? 'auto',
        source: 'pack',
        status: 'active',
        updatedAt: now,
      })
      .run();
    registered.push(seed.id);
  }

  // Log the installation event
  db.insert(schema.events)
    .values({
      projectId,
      type: 'optimization_cycle',
      detail: `Pack installed: ${manifest.name} v${manifest.version} — agent types: ${manifest.agentTypes.join(', ')}`,
    })
    .run();

  const result: InstallPackResult = {
    pack: manifest.name,
    version: manifest.version,
    personasRegistered: registered,
    personasSkipped: skipped,
    agentTypesActivated: manifest.agentTypes,
  };

  broadcastToAll({ type: 'pack:installed', data: result });
  res.status(201).json(result);
});

// GET /api/packs/installed/:projectId — list packs installed for a project
// (proxied from events log — looks for 'Pack installed:' events)
router.get('/packs/installed/:projectId', (req, res) => {
  const db = getDb();
  const { projectId } = req.params;

  const events = db
    .select()
    .from(schema.events)
    .where(eq(schema.events.projectId, projectId))
    .all()
    .filter(
      (e) =>
        e.type === 'optimization_cycle' &&
        (e.detail ?? '').startsWith('Pack installed:'),
    );

  // Parse pack names from event details
  const installed = events.map((e) => {
    const match = (e.detail ?? '').match(/^Pack installed:\s+(\S+)\s+v(\S+)/);
    return {
      pack: match?.[1] ?? 'unknown',
      version: match?.[2] ?? 'unknown',
      installedAt: e.timestamp,
    };
  });

  // Deduplicate by pack name (keep most recent)
  const deduped = new Map<string, (typeof installed)[0]>();
  for (const item of installed) {
    deduped.set(item.pack, item);
  }

  res.json([...deduped.values()]);
});

export default router;
