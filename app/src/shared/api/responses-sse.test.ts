import { describe, expect, it } from "vitest";
import { consumeResponsesSse, parseSseEvents } from "./responses-sse";

describe("Responses SSE parser", () => {
  it("joins multiline data and handles UTF-8 split across chunks", async () => {
    const source = "event: message\ndata: {\"text\":\"你\"}\ndata: {\"text\":\"好\"}\n\n";
    const bytes = new TextEncoder().encode(source);
    const chunks = [bytes.slice(0, 19), bytes.slice(19, 23), bytes.slice(23)];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const events = [];
    for await (const event of parseSseEvents(stream)) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("message");
    expect(events[0]?.data).toContain("你");
    expect(events[0]?.data).toContain("好");
  });

  it("aggregates text, reasoning, tools, and completion", async () => {
    const updates: string[] = [];
    const result = await consumeResponsesSse(
      [
        'data: {"type":"response.output_text.delta","delta":"hel"}\n\n',
        'data: {"type":"response.reasoning_summary_text.delta","delta":"why"}\n\n',
        'data: {"type":"response.output_item.added","item":{"id":"tool-1","type":"web_search_call","name":"web_search"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"r1","output_text":"hello","status":"completed"}}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
      { onUpdate: (snapshot) => updates.push(snapshot.text) },
    );
    expect(result.text).toBe("hello");
    expect(result.reasoning).toBe("why");
    expect(result.responseId).toBe("r1");
    expect(result.tools[0]?.name).toBe("web_search");
    expect(updates.length).toBeGreaterThan(0);
  });

  it("retains partial output on incomplete responses", async () => {
    await expect(
      consumeResponsesSse(
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
      ),
    ).rejects.toMatchObject({ code: "incomplete_response", partialSnapshot: expect.objectContaining({ text: "partial" }) });
  });
});
