import { File } from 'expo-file-system';

/**
 * A finished take as the server's speech endpoint wants it — iOS and Android record AAC in an
 * MPEG-4 container (useRecorder.ts), read from the app's own cache file.
 */
export const RECORDING_MIME = 'audio/mp4' as const;

export function recordingBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}
