# ADR 0010 — Importação e exportação de fluxos (Fase 6a)

**Status:** implementada dentro do que `PROJECT_SPEC.md §4.9` já pede (JSON versionado, resumo antes de importar, rejeitar inválido, nunca executar). Só o **formato do arquivo** e um **código de erro novo** são decisões novas — aguardam seu aval.

## Decisões
1. **Envelope versionado** em volta do fluxo: `{ format: "automation-studio.workflow", formatVersion: 1, exportedAt, appVersion, automation: {name, description}, workflow: <WorkflowDocument> }`. Duas versões independentes: `formatVersion` (envelope) e `workflow.schemaVersion` (fluxo). Qualquer uma desconhecida é **rejeitada** com mensagem que diz qual versão o app entende. Campos extras (em qualquer nível, via `strictObject`) são rejeitados — o arquivo nunca carrega ações/código além do que o schema define.
2. **Exporta a versão salva**, não o rascunho: o arquivo é exatamente o que está gravado. Fluxo nunca salvo → erro pedindo para salvar.
3. **Importar tem duas etapas e o renderer nunca vê nem informa caminhos:** `exchange:import-preview` abre o diálogo nativo (só o Main), valida (tamanho ≤ 5 MB + folga, JSON, envelope, schema) e devolve um **resumo** (nome, nós por tipo, conexões, variáveis, política/tempo limite, problemas do validador, "só Windows") guardado no Main sob um **token**; `exchange:import-confirm` cria a automação com **novo id**, versão 1, a partir do que o Main guardou — o renderer não reenvia o fluxo. Um token por vez, uso único, expira em 15 min.
4. **Importar nunca executa** (teste: contagem de execuções = 0). Fluxo com erros do validador **pode** ser importado (o resumo avisa quantos; o editor mostra e a execução continua bloqueada com erros). Tipo de nó desconhecido aparece como "Desconhecido (tipo)".
5. **Sem segredos:** hoje nenhum campo de nó guarda segredo (a regra continua: segredos só no Credential Manager). O envelope não inclui histórico, logs nem breakpoints.
6. ⚠️ **Novo `ErrorCode` `IO_ERROR`** (arquivo ilegível/sem permissão de escrita) com mensagem segura (sem caminho técnico).
7. **Correção no IPC:** `route` agora aceita handlers assíncronos (diálogos nativos) e responde `{ok,data|error}` — antes uma Promise iria dentro de `data`. Coberto por teste.

## Fora do escopo
"Pacote com recursos" (`§4.9`, último item): ainda não há recursos além do fluxo (imagens vêm na Fase 8). Importar em lote e mesclar com automação existente.

## Consequências
Arquivos de versões futuras do app são recusados em vez de importados pela metade. Trocar o envelope exige subir `EXCHANGE_VERSION`.
