# ADR 0005 — Editor visual, documento de workflow e validação (Fase 2)

**Status:** aceita (aprovada pelo Hector; editor validado no Windows)

## Decisões

1. **Visual separado da config executável** ⚠️. O documento tem `nodes[]` (id, type, version, config) e uma seção `visual.positions` à parte. O roadmap pede a separação; o exemplo de `ARCHITECTURE.md §5` mostra `position` dentro do nó (o texto diz "separar sempre que possível"). Seguimos o texto: o interpretador da Fase 3 ignora `visual`.
2. **Três pacotes**, como em `ARCHITECTURE.md §4`: `workflow-schema` (tipos + zod + `parseWorkflowDocument`), `node-registry` (contratos de nós), `workflow-validator`. O validador roda no renderer (feedback ao vivo) e rodará no Main/interpretador (Fase 3). Consumidos como código-fonte TS e embutidos no bundle; a lista de pacotes do workspace é derivada do `package.json` em `electron.vite.config.ts`.
3. **Contrato de nó declarativo** (`fields[]` com kind/required/min/max/options/pattern), não JSON Schema: "validação equivalente" (`ARCHITECTURE.md §6`). O painel de propriedades e o validador derivam do mesmo contrato.
4. **Contratos provisórios de 18 nós** ⚠️, incluindo os da Fase 4 (arquivos, janelas, teclado/mouse). Só o *contrato* existe; os executores são da Fase 4. Necessário para a paleta/categorias e a validação de parâmetros terem conteúdo real. Podem mudar na Fase 4.
5. **Expressões**: só `{{variables.nome}}` *(ampliado pelo ADR 0008: também `{{nodes.id.resultado}}` e `{{item.propriedade}}`)*. Qualquer outra coisa é erro de validação (sem `eval`, `ARCHITECTURE.md §5`). Variáveis conhecidas = declaradas + definidas por nós "Definir variável".
6. **Persistência**: cada salvamento cria uma versão imutável em `workflow_versions` (migração 0002); salvar conteúdo idêntico não cria versão (o nome da automação não conta: vive na automação). Rascunho inválido pode ser salvo; a validação bloqueará só a execução (Fases 3/5).
7. **Regras do validador**: um `Início manual`; cada saída segue um único caminho; sem auto-ligação; ciclo **sem nó de decisão** (Repetir, Se/Senão, Verificar existência) é aviso de loop infinito — ciclos que passam por decisão são legítimos (é assim que "Repetir" itera); nó inalcançável é aviso.
8. **React Flow** (`@xyflow/react` **13.0.2**, API difere da v12: `onNodesChange` recebe `NodeChangeset`). Canvas *controlado*: o documento é a verdade; posição durante o arraste fica em estado local e vira um passo de desfazer ao soltar. Atribuição "React Flow" mantida visível.
9. **Desfazer/refazer** por snapshots imutáveis (até 100), com junção de digitação no mesmo campo (1 s).

## Fora do escopo desta fase (documentado)
Copiar/colar entre sessões, comentários e agrupamento visual (`PROJECT_SPEC §4.3`), persistência de zoom/pan, edição de `settings` (timeout/política de erro) na UI, execução a partir de nó/passo a passo (Fase 5).

## Consequências
O formato do documento está congelado em `schemaVersion: 1`; mudanças futuras exigem bump + migração do documento. Risco: contratos de nós da Fase 4 podem exigir `version: 2` de alguns nós.
