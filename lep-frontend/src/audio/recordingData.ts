/**
 * A finished take as the server's speech endpoint wants it (POST /v1/media/speech): base64 and
 * its media type — web. The browser records Opus in WebM; the take is a blob: URL that only this
 * page can read. Native builds use recordingData.native.ts.
 */
export const RECORDING_MIME = 'audio/webm' as const;

export async function recordingBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const reader = new FileReader();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('the recording could not be read'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
