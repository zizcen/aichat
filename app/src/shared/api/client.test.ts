import { describe, expect, it, vi } from "vitest";
import { Grok2ApiClient } from "./client";

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

describe("Grok2ApiClient", () => {
  it("uses absolute URLs and omits Bearer on health checks", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('{"status":"ok"}', { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(response('{"object":"list","data":[]}', { headers: { "content-type": "application/json" } }));
    const client = new Grok2ApiClient({ baseUrl: "https://gateway.example/", apiKey: "g2a_test_key", fetch: fetcher });
    await client.health();
    await client.models();
    const healthInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    const modelsInit = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://gateway.example/healthz");
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://gateway.example/v1/models");
    expect(new Headers(healthInit.headers).has("Authorization")).toBe(false);
    expect(new Headers(modelsInit.headers).get("Authorization")).toBe("Bearer g2a_test_key");
  });

  it("parses image URL/base64, video status, and JSON Responses", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('{"created":1,"data":[{"url":"http://127.0.0.1:8000/v1/media/images/i1"},{"b64_json":"AA=="}]}', { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(response('{"request_id":"v1"}', { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(response('{"status":"done","progress":101,"video":{"url":"/v1/media/videos/v1"}}', { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(response('{"id":"r1","output_text":"hello"}', { headers: { "content-type": "application/json" } }));
    const client = new Grok2ApiClient({ baseUrl: "https://gateway.example", apiKey: "g2a_test_key", fetch: fetcher });
    const images = await client.generateImage({ model: "image", prompt: "x" });
    expect(images.map((item) => item.url)).toEqual(["https://gateway.example/v1/media/images/i1", "data:image/png;base64,AA=="]);
    const created = await client.createVideo({ model: "video", prompt: "x" });
    expect(created.requestId).toBe("v1");
    const status = await client.getVideoStatus("v1");
    expect(status.progress).toBe(100);
    expect(status.video?.url).toBe("https://gateway.example/v1/media/videos/v1");
    const result = await client.responses({ model: "chat", input: [{ role: "user", content: "hi" }], stream: false });
    expect(result.text).toBe("hello");
  });

  it("supports binary and JSON TTS plus multipart STT without forcing a boundary", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }))
      .mockResolvedValueOnce(response('{"audio":"AQI=","content_type":"audio/wav","duration":1}', { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(response('{"text":"hello","language":"en"}', { headers: { "content-type": "application/json" } }));
    const client = new Grok2ApiClient({ baseUrl: "https://gateway.example", apiKey: "g2a_test_key", fetch: fetcher });
    const binary = await client.synthesizeSpeech({ model: "voice", text: "hi", language: "en" });
    expect(binary.kind).toBe("binary");
    expect(binary.bytes?.byteLength).toBe(2);
    const encoded = await client.tts({ model: "voice", text: "hi", language: "en" });
    expect(encoded.dataUrl).toBe("data:audio/wav;base64,AQI=");
    const file = new Blob(["hello"], { type: "audio/wav" });
    const transcript = await client.stt({ model: "stt", file, filename: "sample.wav" });
    expect(transcript.text).toBe("hello");
    const init = fetcher.mock.calls[2]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer g2a_test_key");
    expect(headers.has("Content-Type")).toBe(false);
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("accepts completed video jobs that require authenticated content fallback", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response('{"status":"done","progress":100}', { headers: { "content-type": "application/json" } }));
    const client = new Grok2ApiClient({ baseUrl: "https://gateway.example", apiKey: "g2a_test_key", fetch: fetcher });
    await expect(client.getVideoStatus("job-1")).resolves.toMatchObject({ status: "done", progress: 100 });
  });
});
