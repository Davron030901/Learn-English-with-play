import { api, unwrap } from '../client';
import { serverOperations } from '../paths.generated';
import type { components } from '../schema.generated';

/**
 * Recorded speech, scored on the server (POST /v1/media/speech and GET /v1/media/jobs/{id};
 * backend DECISIONS §10.4–10.5, §11.3). The upload is answered at once with a job; the scorer
 * runs after the response, so the app polls. No provider key ever lives in the app: until the
 * server has a scorer (backend R15) it says so — `GET /v1/capabilities` `speech_scoring: false`
 * — and nothing is uploaded.
 */
export type SpeechJob = components['schemas']['SpeechJobOut'];

const operations = serverOperations as readonly string[];
export const serverHasSpeech =
  operations.includes('POST /v1/media/speech') &&
  operations.includes('GET /v1/media/jobs/{job_id}');

/** The longest take the server accepts, and the shortest it counts. */
export const MAX_SPEECH_SECONDS = 300;

export async function submitPronunciation(input: {
  itemId: string;
  audioBase64: string;
  mime: 'audio/webm' | 'audio/mp4';
  seconds: number;
}): Promise<SpeechJob> {
  return unwrap(
    await api.POST('/v1/media/speech', {
      body: {
        purpose: 'pronunciation',
        item_id: input.itemId,
        audio_base64: input.audioBase64,
        mime: input.mime,
        seconds: Math.max(1, Math.min(MAX_SPEECH_SECONDS, Math.ceil(input.seconds))),
      },
    }),
  );
}

export async function fetchSpeechJob(jobId: string): Promise<SpeechJob> {
  return unwrap(await api.GET('/v1/media/jobs/{job_id}', { params: { path: { job_id: jobId } } }));
}
