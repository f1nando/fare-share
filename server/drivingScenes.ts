import { Binary, ObjectId, type Collection } from 'mongodb';

export const MAX_SCENE_IMAGE_BYTES = 8 * 1024 * 1024;

export interface DrivingSceneDocument {
  _id: ObjectId;
  name: string;
  image: Binary;
  imageMime: 'image/png' | 'image/jpeg' | 'image/webp';
  settings: Record<string, number>;
  lightsOn: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class DrivingSceneError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function parseSceneInput(value: unknown, requireImage: boolean) {
  if (!value || typeof value !== 'object') throw new DrivingSceneError('Invalid scene payload.');
  const input = value as Record<string, unknown>;
  const name = String(input.name || '').trim();
  if (!name || name.length > 80) throw new DrivingSceneError('Scene name must contain 1–80 characters.');
  const settings = parseSettings(input.settings);
  const result: {
    name: string;
    settings: Record<string, number>;
    lightsOn: boolean;
    image?: { mime: DrivingSceneDocument['imageMime']; bytes: Buffer };
  } = { name, settings, lightsOn: input.lightsOn === true };
  if (typeof input.imageDataUrl === 'string' && input.imageDataUrl) result.image = parseImageDataUrl(input.imageDataUrl);
  if (requireImage && !result.image) throw new DrivingSceneError('Scene image is required.');
  return result;
}

export function sceneSummary(document: Omit<DrivingSceneDocument, 'image'>) {
  return {
    id: document._id.toHexString(),
    name: document.name,
    settings: document.settings,
    lightsOn: document.lightsOn,
    imageUrl: `/api/driving-scenes/${document._id.toHexString()}/image?v=${document.updatedAt.getTime()}`,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export async function listScenes(collection: Collection<DrivingSceneDocument>) {
  const scenes = await collection.find({}, { projection: { image: 0 } }).sort({ updatedAt: -1 }).toArray();
  return scenes.map(scene => sceneSummary(scene as Omit<DrivingSceneDocument, 'image'>));
}

function parseSettings(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DrivingSceneError('Invalid scene settings.');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64) throw new DrivingSceneError('Too many scene settings.');
  const settings: Record<string, number> = {};
  for (const [key, setting] of entries) {
    if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(key) || !Number.isFinite(setting)) {
      throw new DrivingSceneError('Scene settings contain an invalid value.');
    }
    settings[key] = setting as number;
  }
  return settings;
}

function parseImageDataUrl(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(value);
  if (!match) throw new DrivingSceneError('Only PNG, JPEG and WebP images are supported.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_SCENE_IMAGE_BYTES) {
    throw new DrivingSceneError(`Image must not exceed ${MAX_SCENE_IMAGE_BYTES / 1024 / 1024} MB.`, 413);
  }
  return { mime: match[1] as DrivingSceneDocument['imageMime'], bytes };
}
