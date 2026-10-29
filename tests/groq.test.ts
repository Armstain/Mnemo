import { afterEach, describe, expect, it, vi } from 'vitest';
import { multipartBody, transcribeAudio } from '@/lib/groq';

vi.mock('@/lib/api-key', () => ({ getActiveGroqApiKey: () => 'groq-key' }));

const sound = new Uint8Array([0, 1, 2, 250, 255, 13, 10, 45, 45]);
const recording = {
  uri: 'file:///data/recordings/1-recording.m4a',
  name: '1-recording.m4a',
  mimeType: 'audio/m4a',
  data: Buffer.from(sound).toString('base64'),
};

/** Reads an upload the way a server would (Node's FormData; the app's types are React Native's). */
const parse = async (body: BodyInit, contentType: string) =>
  (await new Response(body, { headers: { 'content-type': contentType } }).formData()) as unknown as {
    get(name: string): string | File | null;
  };

describe('sending a recording to Groq', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds a multipart upload a server reads back exactly: fields, file name and the bytes', async () => {
    const { body, contentType } = multipartBody({ model: 'whisper-large-v3-turbo', response_format: 'json' }, recording);
    const form = await parse(body.buffer as ArrayBuffer, contentType);
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('response_format')).toBe('json');
    const file = form.get('file') as File;
    expect(file.name).toBe('1-recording.m4a');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(sound);
  });

  it('posts bytes, not FormData with a uri (which the app\'s fetch rejects), and reads the words back', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.body).not.toBeInstanceOf(FormData);
      const form = await parse(init.body as ArrayBuffer, (init.headers as Record<string, string>)['Content-Type']);
      expect((form.get('file') as File).size).toBe(sound.length);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer groq-key');
      return new Response(JSON.stringify({ text: ' kal bazar e jabo ' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await transcribeAudio([recording])).toBe('kal bazar e jabo');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps Groq's reason when it says no", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"Invalid file format"}}', { status: 400 })));
    await expect(transcribeAudio([recording])).rejects.toThrow(/400.*Invalid file format/);
  });
});
