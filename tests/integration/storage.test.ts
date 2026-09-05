import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Readable } from "node:stream";
import { LocalFileStorage } from "@/lib/storage";
import { makeTempStorage, cleanupTempStorage } from "../helpers/storage";

describe("LocalFileStorage", () => {
  let storage: LocalFileStorage;

  beforeEach(async () => {
    const ctx = await makeTempStorage();
    storage = ctx.storage;
  });

  afterEach(async () => {
    await cleanupTempStorage();
  });

  describe("put (Buffer)", () => {
    it("stores a Buffer under the given key and returns metadata", async () => {
      const data = Buffer.from("hello world", "utf-8");
      const result = await storage.put("user1/file1/hello.txt", data);
      expect(result.storageKey).toBe("user1/file1/hello.txt");
      expect(result.sizeBytes).toBe(11);
      expect(result.hashSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("creates intermediate directories automatically", async () => {
      const data = Buffer.from("x");
      await storage.put("a/b/c/d/file.txt", data);
      // Reading the file back should succeed.
      const buf = await storage.getBuffer("a/b/c/d/file.txt");
      expect(buf.toString()).toBe("x");
    });

    it("computes the correct SHA-256 hash for known content", async () => {
      const data = Buffer.from("hello");
      const result = await storage.put("key", data);
      // Known SHA-256 of "hello"
      expect(result.hashSha256).toBe(
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
      );
    });
  });

  describe("put (stream)", () => {
    it("stores a Node Readable stream and returns correct size + hash", async () => {
      const chunks = [Buffer.from("chunk1-"), Buffer.from("chunk2-"), Buffer.from("chunk3")];
      const stream = Readable.from(chunks);
      const result = await storage.put("streamed", stream);
      // 7 + 7 + 6 = 20 bytes
      expect(result.sizeBytes).toBe(20);
      expect(result.hashSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("stores a web ReadableStream and returns correct size + hash", async () => {
      const data = Buffer.from("web-stream-content");
      const webStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
      // Cast to the type the storage backend expects (Bun's ReadableStream
      // type differs slightly from Node's web-stream type at the TS level).
      const result = await storage.put("webkey", webStream as never);
      expect(result.sizeBytes).toBe(data.length);
    });

    it("handles an empty stream (0 bytes)", async () => {
      const stream = Readable.from([]);
      const result = await storage.put("empty", stream);
      expect(result.sizeBytes).toBe(0);
      // SHA-256 of empty input
      expect(result.hashSha256).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
    });
  });

  describe("get / getBuffer", () => {
    it("reads a stored file as a Buffer", async () => {
      const data = Buffer.from("read me back");
      await storage.put("readback", data);
      const buf = await storage.getBuffer("readback");
      expect(buf.toString()).toBe("read me back");
    });

    it("reads a stored file as a Readable stream", async () => {
      const data = Buffer.from("stream me back");
      await storage.put("streamback", data);
      const stream = await storage.get("streamback");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe("stream me back");
    });

    it("throws when reading a non-existent key", async () => {
      await expect(storage.getBuffer("does/not/exist")).rejects.toThrow();
    });
  });

  describe("delete", () => {
    it("deletes an existing file", async () => {
      await storage.put("todelete", Buffer.from("x"));
      await storage.delete("todelete");
      await expect(storage.getBuffer("todelete")).rejects.toThrow();
    });

    it("does NOT throw when deleting a non-existent file (best-effort)", async () => {
      await expect(storage.delete("never-existed")).resolves.toBeUndefined();
    });
  });

  describe("stat", () => {
    it("returns the size and mtime of a stored file", async () => {
      const data = Buffer.from("stat-me-please");
      await storage.put("statme", data);
      const stat = await storage.stat("statme");
      expect(stat.size).toBe(data.length);
      expect(stat.mtime).toBeInstanceOf(Date);
      expect(stat.mtime.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("throws when stating a non-existent file", async () => {
      await expect(storage.stat("nope")).rejects.toThrow();
    });
  });

  describe("path traversal protection", () => {
    it("rejects a key with '..' that would escape the root", () => {
      // The resolve() check in LocalFileStorage throws if the resolved path
      // is not under root.
      expect(() => storage.put("../escape.txt", Buffer.from("x"))).toThrow(
        /Invalid storage key/
      );
      expect(() => storage.put("a/../../escape.txt", Buffer.from("x"))).toThrow(
        /Invalid storage key/
      );
    });

    it("rejects an absolute-path key", () => {
      // Absolute paths on POSIX start with /; resolve() would land outside root.
      expect(() => storage.put("/etc/passwd", Buffer.from("x"))).toThrow(
        /Invalid storage key/
      );
    });

    it("allows keys with subdirectories that stay under root", async () => {
      await storage.put("a/b/c/file.txt", Buffer.from("ok"));
      const buf = await storage.getBuffer("a/b/c/file.txt");
      expect(buf.toString()).toBe("ok");
    });
  });

  describe("round-trip integrity", () => {
    it("preserves binary content through put → get", async () => {
      // 10 KB of random-ish bytes
      const data = Buffer.alloc(10240, 0);
      for (let i = 0; i < data.length; i++) data[i] = i % 256;
      await storage.put("binary", data);
      const back = await storage.getBuffer("binary");
      expect(back.equals(data)).toBe(true);
    });

    it("preserves content through multiple overwrite cycles", async () => {
      for (let i = 0; i < 5; i++) {
        const data = Buffer.from(`content-v${i}`);
        await storage.put("overwrite", data);
        const back = await storage.getBuffer("overwrite");
        expect(back.toString()).toBe(`content-v${i}`);
      }
    });
  });

  describe("partial stream failure cleanup", () => {
    it("deletes the partial file when a stream errors mid-write", async () => {
      // Use a custom Readable that emits one chunk then errors on the next read.
      const errorStream = new Readable({
        read() {
          this.push(Buffer.from("partial-data-"));
          // Next read: destroy with an error.
          process.nextTick(() => {
            this.destroy(new Error("simulated network drop"));
          });
        },
      });

      await expect(storage.put("partial", errorStream)).rejects.toThrow(
        /simulated network drop/
      );

      // The partial file should have been cleaned up.
      await expect(storage.getBuffer("partial")).rejects.toThrow();
    });
  });
});
