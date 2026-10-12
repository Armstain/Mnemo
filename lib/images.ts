import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { Block, Entry } from '@/types/mnemo';

// Photos in notes. Each is shrunk to at most 1600px on its long side
// (plenty for a receipt or a whiteboard, a fraction of a camera original)
// and kept in the app's own folder, named, not by full path: an app update
// on iOS moves that folder. The web build keeps a data URL instead.

const MAX_SIDE = 1600;
const QUALITY = 0.8;

export type ImageBlock = Extract<Block, { kind: 'image' }>;

function imagesDir(): Directory {
  const dir = new Directory(Paths.document, 'images');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function newName(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`;
}

/** Copies a picked or shared photo into the app, smaller. */
export async function keepImage(sourceUri: string): Promise<ImageBlock> {
  let ref = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const long = Math.max(ref.width, ref.height);
  if (long > MAX_SIDE) {
    const size = ref.width >= ref.height ? { width: MAX_SIDE } : { height: MAX_SIDE };
    ref = await ImageManipulator.manipulate(sourceUri).resize(size).renderAsync();
  }
  if (Platform.OS === 'web') {
    const saved = await ref.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG, base64: true });
    return { kind: 'image', src: `data:image/jpeg;base64,${saved.base64}`, width: saved.width, height: saved.height };
  }
  const saved = await ref.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
  const name = newName();
  new File(saved.uri).move(new File(imagesDir(), name));
  return { kind: 'image', file: name, width: saved.width, height: saved.height };
}

/** Where to load a photo block from, or undefined if it isn't on this phone. */
export function imageUri(block: ImageBlock): string | undefined {
  if (block.src) return block.src;
  if (!block.file || Platform.OS === 'web') return undefined;
  const file = new File(Paths.document, 'images', block.file);
  return file.exists ? file.uri : undefined;
}

/** The photo's bytes as base64 (for Gemini, or a backup). */
export async function imageBase64(block: ImageBlock): Promise<string | undefined> {
  if (block.src?.startsWith('data:')) return block.src.slice(block.src.indexOf(',') + 1);
  if (!block.file || Platform.OS === 'web') return undefined;
  const file = new File(Paths.document, 'images', block.file);
  return file.exists ? file.base64() : undefined;
}

/** Writes a photo restored from a backup, unless it's already here. */
export function restoreImage(name: string, base64: string): void {
  if (Platform.OS === 'web' || !/^[\w.-]+$/.test(name)) return;
  const file = new File(imagesDir(), name);
  if (file.exists) return;
  file.create();
  file.write(base64, { encoding: 'base64' });
}

export function imagesOf(entries: Pick<Entry, 'blocks'>[]): ImageBlock[] {
  return entries.flatMap((e) => e.blocks.filter((b): b is ImageBlock => b.kind === 'image'));
}

/** Deletes the files behind photo blocks (when their entry is gone for good). */
export function forgetImages(entries: Pick<Entry, 'blocks'>[]): void {
  if (Platform.OS === 'web') return;
  for (const block of imagesOf(entries)) {
    if (!block.file) continue;
    try {
      new File(Paths.document, 'images', block.file).delete();
    } catch {
      // Already gone.
    }
  }
}

/** "Clear all data". */
export function deleteAllImages(): void {
  if (Platform.OS === 'web') return;
  try {
    new Directory(Paths.document, 'images').delete();
  } catch {
    // Never existed.
  }
}

/**
 * Lets the person take or choose photos, and keeps them. Resolves with
 * nothing if they back out or say no to the camera.
 */
export async function pickPhotos(source: 'camera' | 'library'): Promise<ImageBlock[]> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return [];
  }
  const options = { mediaTypes: ['images'] as ImagePicker.MediaType[], quality: 1, allowsMultipleSelection: source === 'library', selectionLimit: 6 };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];
  const kept: ImageBlock[] = [];
  for (const asset of result.assets) {
    try {
      kept.push(await keepImage(asset.uri));
    } catch {
      // One unreadable photo doesn't stop the rest.
    }
  }
  return kept;
}
