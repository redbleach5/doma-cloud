import { describe, expect, it, afterEach } from "bun:test";
import { render } from "@testing-library/react";
import { resetDom } from "../../helpers/react";
import { FileIcon } from "@/components/cloud/file-icon";
import type { FileItem } from "@/lib/cloud/api";

function makeItem(over: Partial<FileItem> = {}): FileItem {
  return {
    id: "f1",
    parentId: null,
    name: "file.txt",
    isDirectory: false,
    sizeBytes: "0",
    mimeType: "text/plain",
    category: "text",
    deletedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("FileIcon component", () => {
  afterEach(() => {
    resetDom();
  });

  it("renders a folder icon when isDirectory=true", () => {
    const { container } = render(<FileIcon item={makeItem({ isDirectory: true, name: "folder" })} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Folders use text-amber-500 (no conflicting muted-foreground applied).
    expect(svg?.getAttribute("class")).toContain("text-amber-500");
  });

  it("always renders exactly one svg element for any category", () => {
    const { container } = render(<FileIcon item={makeItem()} />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("applies the custom className when provided (for directories)", () => {
    const { container } = render(
      <FileIcon item={makeItem({ isDirectory: true })} className="h-10 w-10" />
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("h-10");
    expect(svg?.getAttribute("class")).toContain("w-10");
    // The folder amber color is preserved.
    expect(svg?.getAttribute("class")).toContain("text-amber-500");
  });

  describe("per-category icon colors", () => {
    it("image icons use text-emerald-500", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "photo.jpg", category: "image", mimeType: "image/jpeg" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-emerald-500");
      expect(svg?.getAttribute("class")).not.toContain("text-muted-foreground");
    });

    it("video icons use text-rose-500", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "movie.mp4", category: "video", mimeType: "video/mp4" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-rose-500");
    });

    it("audio icons use text-purple-500", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "song.mp3", category: "audio", mimeType: "audio/mpeg" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-purple-500");
    });

    it("pdf icons use text-red-500", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "doc.pdf", category: "pdf", mimeType: "application/pdf" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-red-500");
    });

    it("code icons use text-sky-500", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "app.js", category: "code", mimeType: "text/javascript" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-sky-500");
    });

    it("text icons use text-blue-500", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "notes.txt", category: "text" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-blue-500");
    });

    it("office icons use text-amber-600", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "doc.docx", category: "office" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-amber-600");
    });

    it("archive icons use text-yellow-700", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "file.zip", category: "archive" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-yellow-700");
    });

    it("'other' icons use muted-foreground", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "file.bin", category: "other" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-muted-foreground");
    });

    it("markdown icons use text-orange-500", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "README.md", category: "markdown" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("text-orange-500");
    });
  });

  describe("icon selection (regardless of color)", () => {
    // These tests verify that the CORRECT lucide icon component is selected
    // for each category, even though the color is wrong. We check the lucide
    // icon name embedded in the SVG's class list (lucide-react adds a
    // `lucide-<icon-name>` class).

    it("renders the Folder icon for directories", () => {
      const { container } = render(<FileIcon item={makeItem({ isDirectory: true })} />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-folder");
    });

    it("renders the FileImage icon for image files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "photo.jpg", category: "image", mimeType: "image/jpeg" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-image");
    });

    it("renders the FileVideo icon for video files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "movie.mp4", category: "video", mimeType: "video/mp4" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-video");
    });

    it("renders the FileAudio icon for audio files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "song.mp3", category: "audio", mimeType: "audio/mpeg" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-audio");
    });

    it("renders the FileType icon for PDF files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "doc.pdf", category: "pdf", mimeType: "application/pdf" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-type");
    });

    it("renders the FileCode icon for code files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "app.js", category: "code", mimeType: "text/javascript" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-code");
    });

    it("renders the FileText icon for markdown files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "README.md", category: "markdown" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-text");
    });

    it("renders the FileSpreadsheet icon for office files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "doc.docx", category: "office" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-spreadsheet");
    });

    it("renders the FileArchive icon for archive files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "file.zip", category: "archive" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-archive");
    });

    it("renders the FileText icon for text files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "notes.txt", category: "text" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file-text");
    });

    it("renders the generic File icon for 'other' files", () => {
      const { container } = render(
        <FileIcon item={makeItem({ name: "file.bin", category: "other" })} />
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("lucide-file");
    });
  });
});
