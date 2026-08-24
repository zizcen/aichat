import { createServer } from "node:http";

const port = Number(process.env.MOCK_GROK2API_PORT ?? 8787);
const videoPolls = new Map();

const models = [
  {
    id: "grok-4.5",
    object: "model",
    created: 0,
    owned_by: "mock",
    capability: "responses",
  },
  {
    id: "grok-imagine-image-2.0",
    object: "model",
    created: 0,
    owned_by: "mock",
    capability: "image",
  },
  {
    id: "grok-imagine-video",
    object: "model",
    created: 0,
    owned_by: "mock",
    capability: "video",
  },
  {
    id: "grok-voice-latest",
    object: "model",
    created: 0,
    owned_by: "mock",
    capability: "tts",
  },
  {
    id: "grok-stt",
    object: "model",
    created: 0,
    owned_by: "mock",
    capability: "stt",
  },
];

const transparentPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const server = createServer(async (request, response) => {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname === "/healthz" || url.pathname === "/readyz")
    return json(response, 200, { status: "ok" });
  if (!request.headers.authorization?.startsWith("Bearer "))
    return json(response, 401, {
      error: { message: "mock key missing", code: "invalid_api_key" },
    });
  if (request.method === "GET" && url.pathname === "/v1/models")
    return json(response, 200, { object: "list", data: models });
  if (request.method === "POST" && url.pathname === "/v1/responses")
    return streamResponse(response);
  if (request.method === "POST" && url.pathname === "/v1/images/generations") {
    const body = await readJson(request);
    const count = Math.max(1, Math.min(4, Number(body.n) || 1));
    return json(response, 200, {
      created: Date.now(),
      data: Array.from({ length: count }, (_, index) => ({
        b64_json: transparentPng,
        revised_prompt: `Mock image ${index + 1}`,
      })),
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/videos/generations") {
    const body = await readJson(request);
    const requestId = `mock-video-${Date.now()}`;
    videoPolls.set(requestId, {
      polls: 0,
      fail: String(body.prompt ?? "").includes("失败"),
      protected: String(body.prompt ?? "").includes("受保护"),
    });
    return json(response, 200, { request_id: requestId });
  }
  const videoMatch = /^\/v1\/videos\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && videoMatch) {
    const requestId = decodeURIComponent(videoMatch[1]);
    const state = videoPolls.get(requestId) ?? {
      polls: 0,
      fail: false,
      protected: false,
    };
    state.polls += 1;
    videoPolls.set(requestId, state);
    return state.polls < 2
      ? json(response, 200, { status: "pending", progress: 45 })
      : state.fail
        ? json(response, 200, {
            status: "failed",
            progress: 45,
            error: { code: "mock_failed", message: "模拟视频失败" },
          })
        : state.protected
          ? json(response, 200, { status: "done", progress: 100 })
          : json(response, 200, {
              status: "done",
              progress: 100,
              video: { url: `/v1/media/videos/${requestId}`, duration: 6 },
            });
  }
  if (
    request.method === "GET" &&
    url.pathname.endsWith("/content") &&
    url.pathname.startsWith("/v1/videos/")
  ) {
    response
      .writeHead(200, { "Content-Type": "video/mp4" })
      .end(Buffer.from("mock-video-content"));
    return;
  }
  if (
    request.method === "GET" &&
    url.pathname.startsWith("/v1/media/videos/")
  ) {
    response
      .writeHead(200, { "Content-Type": "video/mp4", "Content-Length": "0" })
      .end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/tts/voices")
    return json(response, 200, {
      voices: [{ voice_id: "eve", name: "Eve", language: "zh" }],
    });
  if (request.method === "POST" && url.pathname === "/v1/tts")
    return json(response, 200, {
      audio: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
      content_type: "audio/wav",
      duration: 0,
    });
  if (request.method === "POST" && url.pathname === "/v1/stt") {
    await drain(request);
    return json(response, 200, {
      text: "这是本地模拟转写结果。",
      language: "zh",
      duration: 1.2,
      words: [{ text: "模拟", start: 0, end: 0.5 }],
    });
  }
  return json(response, 404, {
    error: { message: "mock endpoint not found", code: "not_found" },
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Mock grok2api listening on http://127.0.0.1:${port}\n`);
});

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept",
  );
  response.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS",
  );
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function streamResponse(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  const events = [
    { type: "response.reasoning_summary_text.delta", delta: "本地模拟思考。" },
    { type: "response.output_text.delta", delta: "你好，" },
    {
      type: "response.output_item.added",
      item: { id: "tool-1", type: "web_search_call", name: "web_search" },
    },
    { type: "response.output_text.delta", delta: "这是流式模拟回复。" },
    {
      type: "response.completed",
      response: {
        id: "mock-response",
        status: "completed",
        output_text: "你好，这是流式模拟回复。",
      },
    },
  ];
  let index = 0;
  const timer = setInterval(() => {
    if (index < events.length)
      response.write(`data: ${JSON.stringify(events[index++])}\n\n`);
    else {
      clearInterval(timer);
      response.end("data: [DONE]\n\n");
    }
  }, 250);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function drain(request) {
  for await (const chunk of request) {
    void chunk;
  }
}
