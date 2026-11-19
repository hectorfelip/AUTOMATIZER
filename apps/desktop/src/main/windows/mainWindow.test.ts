import { describe, expect, it } from "vitest";
import { matchesAppFile } from "./mainWindow.js";

const INDEX = "file:///C:/Program%20Files/Automation%20Studio/resources/app/out/renderer/index.html";

describe("matchesAppFile (origem confiável do IPC)", () => {
  it("aceita só a página do app, com ou sem hash/query", () => {
    expect(matchesAppFile(INDEX, INDEX)).toBe(true);
    expect(matchesAppFile(INDEX + "#/x", INDEX)).toBe(true);
    expect(matchesAppFile(INDEX + "?a=1", INDEX)).toBe(true);
  });
  it.each([
    "file:///C:/Users/x/Downloads/malicioso.html",
    "file:///C:/Program%20Files/Automation%20Studio/resources/app/out/renderer/outro.html",
    "file:///C:/Program%20Files/Automation%20Studio/resources/app/out/renderer/index.html.evil",
    "https://evil.example/index.html",
    "http://localhost:5173/",
    "javascript:alert(1)",
    "about:blank",
    "",
    "não é url",
  ])("recusa %s", (url) => {
    expect(matchesAppFile(url, INDEX)).toBe(false);
  });
});
