import { describe, expect, it } from "vitest";
import type { AvailableRefs } from "@automation-studio/workflow-validator";
import { insertReference, referenceOptions, replacesValue } from "./referenceOptions";

const refs: AvailableRefs = {
  variables: ["destino", "origem"],
  results: [
    { nodeId: "listar", nodeLabel: "Listar arquivos", key: "count", label: "Quantidade de arquivos", type: "number", ref: "{{nodes.listar.count}}" },
    { nodeId: "listar", nodeLabel: "Listar arquivos", key: "files", label: "Arquivos", type: "list", ref: "{{nodes.listar.files}}" },
    { nodeId: "x", nodeLabel: "Algo", key: "meta", label: "Meta", type: "object", ref: "{{nodes.x.meta}}" },
  ],
  loops: [{ name: "item", refs: ["{{item}}", "{{item.name}}", "{{item.path}}"] }],
};
const all = (g: ReturnType<typeof referenceOptions>) => g.flatMap((x) => x.options.map((o) => o.ref));

describe("referenceOptions", () => {
  it("campo de texto: variáveis, resultados simples e propriedades do item (sem listas nem objetos inteiros)", () => {
    const g = referenceOptions(refs, "text");
    expect(g.map((x) => x.label)).toEqual(["Variáveis", "Resultados de nós anteriores", "Item “item” do laço"]);
    expect(all(g)).toEqual(["{{variables.destino}}", "{{variables.origem}}", "{{nodes.listar.count}}", "{{item.name}}", "{{item.path}}"]);
    expect(all(g)).not.toContain("{{nodes.listar.files}}"); // lista inteira não cabe em texto
    expect(all(g)).not.toContain("{{nodes.x.meta}}");
  });
  it("campo lista: só listas de nós anteriores", () => {
    const g = referenceOptions(refs, "list");
    expect(all(g)).toEqual(["{{nodes.listar.files}}"]);
    expect(g[0]!.options[0]!.label).toBe("Listar arquivos › Arquivos");
  });
  it("sem nada disponível, não oferece nada", () => {
    expect(referenceOptions({ variables: [], results: [], loops: [] }, "text")).toEqual([]);
    expect(referenceOptions({ variables: ["a"], results: [], loops: [] }, "list")).toEqual([]);
  });
  it("laço de itens simples (sem propriedades conhecidas) oferece o item inteiro", () => {
    const g = referenceOptions({ variables: [], results: [], loops: [{ name: "linha", refs: ["{{linha}}"] }] }, "text");
    expect(all(g)).toEqual(["{{linha}}"]);
  });
  it("rótulos dizem o tipo do resultado", () => {
    expect(referenceOptions(refs, "text")[1]!.options[0]!.label).toBe("Listar arquivos › Quantidade de arquivos (número)");
  });
});

describe("insertReference", () => {
  it("texto: acrescenta ao que já existe; campo vazio recebe só a referência", () => {
    expect(insertReference("", "{{variables.a}}", "text")).toBe("{{variables.a}}");
    expect(insertReference("   ", "{{variables.a}}", "path")).toBe("{{variables.a}}");
    expect(insertReference("C:\\x\\", "{{item.name}}", "path")).toBe("C:\\x\\{{item.name}}");
  });
  it("número e lista: a referência substitui (concatenar quebraria o tipo)", () => {
    expect(insertReference("3", "{{nodes.l.count}}", "number")).toBe("{{nodes.l.count}}");
    expect(insertReference("{{nodes.a.files}}", "{{nodes.b.files}}", "list")).toBe("{{nodes.b.files}}");
    expect(replacesValue("number") && replacesValue("list") && !replacesValue("text")).toBe(true);
  });
});
