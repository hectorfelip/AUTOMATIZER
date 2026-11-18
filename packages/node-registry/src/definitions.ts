import type { CategoryId, ConfigField, NodeDefinition, Port } from "./types.js";

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "control", label: "Controle" },
  { id: "data", label: "Dados" },
  { id: "files", label: "Arquivos e pastas" },
  { id: "windows", label: "Janelas e aplicativos" },
  { id: "input", label: "Mouse e teclado" },
];

const IN: Port[] = [{ id: "input", label: "Entrada" }];
const NEXT: Port[] = [{ id: "next", label: "Próximo" }];
const OK_ERR: Port[] = [
  { id: "success", label: "Sucesso" },
  { id: "error", label: "Erro" },
];
const YES_NO: Port[] = [
  { id: "true", label: "Verdadeiro" },
  { id: "false", label: "Falso" },
];

const path = (key: string, label: string, extra: Partial<ConfigField> = {}): ConfigField => ({
  key,
  label,
  kind: "path",
  required: true,
  placeholder: "C:\\Pasta\\arquivo.txt",
  ...extra,
});

/**
 * Contratos v1 (provisórios até a Fase 4 implementar os executores): o que cada nó expõe ao editor.
 * Campos de texto/caminho aceitam `{{variables.nome}}`.
 */
export const NODE_DEFINITIONS: NodeDefinition[] = [
  // ---- Controle ----
  {
    type: "trigger.manual",
    version: 1,
    label: "Início manual",
    category: "control",
    description: "Ponto de partida do fluxo, iniciado pelo usuário.",
    inputs: [],
    outputs: NEXT,
    fields: [],
    unique: true,
  },
  {
    type: "flow.end",
    version: 1,
    label: "Fim",
    category: "control",
    description: "Encerra o fluxo.",
    inputs: IN,
    outputs: [],
    fields: [{ key: "message", label: "Mensagem final", kind: "text", placeholder: "Concluído" }],
  },
  {
    type: "flow.wait",
    version: 1,
    label: "Esperar",
    category: "control",
    description: "Aguarda uma duração antes de continuar.",
    inputs: IN,
    outputs: NEXT,
    fields: [{ key: "seconds", label: "Segundos", kind: "number", required: true, default: 1, min: 0, max: 86_400 }],
  },
  {
    type: "flow.condition",
    version: 1,
    label: "Se / Senão",
    category: "control",
    description: "Segue por um caminho ou outro conforme a comparação.",
    inputs: IN,
    outputs: YES_NO,
    fields: [
      { key: "left", label: "Valor", kind: "text", required: true, placeholder: "{{variables.contador}}" },
      {
        key: "operator",
        label: "Operador",
        kind: "select",
        required: true,
        default: "equals",
        options: [
          { value: "equals", label: "é igual a" },
          { value: "not_equals", label: "é diferente de" },
          { value: "greater", label: "é maior que" },
          { value: "less", label: "é menor que" },
          { value: "contains", label: "contém" },
        ],
      },
      { key: "right", label: "Comparar com", kind: "text", required: true },
    ],
  },
  {
    type: "flow.repeat",
    version: 1,
    label: "Repetir N vezes",
    category: "control",
    description: "Executa o caminho 'Corpo' N vezes e depois segue por 'Depois'.",
    inputs: IN,
    outputs: [
      { id: "body", label: "Corpo" },
      { id: "done", label: "Depois" },
    ],
    fields: [{ key: "times", label: "Vezes", kind: "number", required: true, default: 3, min: 1, max: 100_000 }],
  },
  // ---- Dados ----
  {
    type: "data.set_variable",
    version: 1,
    label: "Definir variável",
    category: "data",
    description: "Guarda um valor em uma variável do fluxo.",
    inputs: IN,
    outputs: NEXT,
    fields: [
      {
        key: "name",
        label: "Nome da variável",
        kind: "text",
        required: true,
        pattern: "^[A-Za-z_][A-Za-z0-9_]{0,63}$",
        patternMessage: "Use letras, números e _, começando por letra ou _ (máx. 64).",
      },
      { key: "value", label: "Valor", kind: "text" },
    ],
  },
  // ---- Arquivos e pastas ----
  {
    type: "files.list",
    version: 1,
    label: "Listar arquivos",
    category: "files",
    description: "Lista os arquivos de uma pasta.",
    inputs: IN,
    outputs: OK_ERR,
    fields: [
      path("path", "Pasta", { placeholder: "{{variables.pastaDownloads}}" }),
      { key: "pattern", label: "Filtro", kind: "text", default: "*", placeholder: "*.pdf" },
      { key: "recursive", label: "Incluir subpastas", kind: "boolean", default: false },
    ],
  },
  {
    type: "files.exists",
    version: 1,
    label: "Verificar existência",
    category: "files",
    description: "Verifica se um arquivo ou pasta existe.",
    inputs: IN,
    outputs: [
      { id: "true", label: "Existe" },
      { id: "false", label: "Não existe" },
    ],
    fields: [path("path", "Caminho")],
  },
  {
    type: "files.create_folder",
    version: 1,
    label: "Criar pasta",
    category: "files",
    description: "Cria uma pasta (e as intermediárias).",
    inputs: IN,
    outputs: OK_ERR,
    fields: [path("path", "Pasta")],
  },
  {
    type: "files.copy",
    version: 1,
    label: "Copiar arquivo",
    category: "files",
    description: "Copia um arquivo para outro local.",
    inputs: IN,
    outputs: OK_ERR,
    fields: [
      path("source", "Origem"),
      path("destination", "Destino"),
      { key: "overwrite", label: "Sobrescrever se existir", kind: "boolean", default: false },
    ],
  },
  {
    type: "files.move",
    version: 1,
    label: "Mover arquivo",
    category: "files",
    description: "Move um arquivo para outro local.",
    inputs: IN,
    outputs: OK_ERR,
    fields: [
      path("source", "Origem"),
      path("destination", "Destino"),
      { key: "overwrite", label: "Sobrescrever se existir", kind: "boolean", default: false },
    ],
  },
  {
    type: "files.rename",
    version: 1,
    label: "Renomear arquivo",
    category: "files",
    description: "Renomeia um arquivo ou pasta.",
    inputs: IN,
    outputs: OK_ERR,
    fields: [path("path", "Caminho atual"), { key: "newName", label: "Novo nome", kind: "text", required: true }],
  },
  // ---- Janelas e aplicativos ----
  {
    type: "windows.open_app",
    version: 1,
    label: "Abrir aplicativo",
    category: "windows",
    description: "Inicia um aplicativo.",
    inputs: IN,
    outputs: OK_ERR,
    fields: [
      path("application", "Aplicativo", { placeholder: "notepad.exe" }),
      { key: "arguments", label: "Argumentos", kind: "text" },
    ],
  },
  {
    type: "windows.activate_window",
    version: 1,
    label: "Ativar janela",
    category: "windows",
    description: "Localiza uma janela pelo título e a traz para frente.",
    inputs: IN,
    outputs: OK_ERR,
    fields: [
      { key: "title", label: "Título da janela", kind: "text", required: true, placeholder: "Bloco de Notas" },
      { key: "timeoutSeconds", label: "Esperar até (s)", kind: "number", default: 10, min: 0, max: 3600 },
    ],
  },
  // ---- Mouse e teclado ----
  {
    type: "input.type_text",
    version: 1,
    label: "Digitar texto",
    category: "input",
    description: "Digita um texto na janela ativa.",
    inputs: IN,
    outputs: OK_ERR,
    fields: [{ key: "text", label: "Texto", kind: "text", required: true }],
  },
  {
    type: "input.hotkey",
    version: 1,
    label: "Atalho de teclado",
    category: "input",
    description: "Pressiona uma combinação de teclas.",
    inputs: IN,
    outputs: OK_ERR,
    fields: [{ key: "keys", label: "Teclas", kind: "text", required: true, placeholder: "ctrl+s" }],
  },
  {
    type: "input.click",
    version: 1,
    label: "Clique",
    category: "input",
    description: "Clica em uma posição da tela (último recurso: frágil com DPI/resolução).",
    inputs: IN,
    outputs: OK_ERR,
    fields: [
      { key: "x", label: "X", kind: "number", required: true, min: 0, max: 100_000 },
      { key: "y", label: "Y", kind: "number", required: true, min: 0, max: 100_000 },
      {
        key: "button",
        label: "Botão",
        kind: "select",
        required: true,
        default: "left",
        options: [
          { value: "left", label: "Esquerdo" },
          { value: "right", label: "Direito" },
          { value: "double", label: "Duplo clique" },
        ],
      },
    ],
  },
];
