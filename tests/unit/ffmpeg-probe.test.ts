import { describe, expect, it } from "bun:test";
import { parseProbeJson } from "@/lib/media/ffmpeg";

describe("parseProbeJson (pure, no ffmpeg spawn)", () => {
  it("parses codec / width / height / duration", () => {
    const p = parseProbeJson(
      JSON.stringify({
        streams: [{ codec_name: "h264", width: 1920, height: 1080, duration: "60.5" }],
        format: { duration: "60.5" },
      })
    );
    expect(p).toEqual({ codec: "h264", width: 1920, height: 1080, durationMs: 60_500 });
  });

  it("falls back to the stream duration when format duration is absent", () => {
    const p = parseProbeJson(
      JSON.stringify({
        streams: [{ codec_name: "hevc", width: 3840, height: 2160, duration: "10.25" }],
      })
    );
    expect(p?.codec).toBe("hevc");
    expect(p?.durationMs).toBe(10_250);
  });

  it("returns null for invalid json or missing video stream", () => {
    expect(parseProbeJson("not json")).toBeNull();
    expect(parseProbeJson("{}")).toBeNull();
    expect(parseProbeJson(JSON.stringify({ format: { duration: "3" } }))).toBeNull();
  });

  it("handles missing duration as null", () => {
    const p = parseProbeJson(
      JSON.stringify({ streams: [{ codec_name: "av1", width: 640, height: 360 }] })
    );
    expect(p?.codec).toBe("av1");
    expect(p?.durationMs).toBeNull();
  });
});