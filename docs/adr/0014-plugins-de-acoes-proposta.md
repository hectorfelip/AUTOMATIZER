# ADR 0014 — API de plugins de ações (Fase 8)

**Status:** **opção A (declarativa) IMPLEMENTADA** sob a diretriz `/goal` (seguir até o fim), por ser a recomendada e a de menor risco — **aguarda sua confirmação formal; reversível** (remover o serviço/migração `0005`). **Opção B (código Python) NÃO implementada.** Formato e regras em `docs/PLUGINS.md`. Roadmap: "Definir API de plugins de ações", "Documentar criação de novos nós"; critério: "plugins são validados e carregados de forma controlada".

## O problema de segurança
Um plugin que traz **código Python** roda dentro do motor com **todas as permissões do usuário** (arquivos, rede, teclado/mouse). Isso colide com o invariante "sem shell arbitrário; lista explícita de ações permitidas" e com a importação de fluxos nunca executar nada. "Controlado" precisa significar: **o usuário escolhe, vê o que é, e nada carrega sozinho**.

## Opções
| | A. **Pacote declarativo** (sem código) | B. **Plugin com código Python** |
|---|---|---|
| O que é | JSON com um *nó novo* definido por composição: nome, campos, resultados e **qual fluxo/ações existentes executa** (um subfluxo empacotado, ADR 0013) | Pasta com `manifest.json` + módulo Python que registra ações no motor |
| Poder | Só combina ações **já permitidas**; não adiciona capacidades | Qualquer coisa que o Python faça |
| Risco | Baixo: o validador e o interpretador já cobrem | **Alto**: execução arbitrária de código |
| Esforço | Pequeno (reusa subfluxos, registro de nós e validador) | Grande: manifesto, carga isolada, consentimento, hash, atualização |
| Testável aqui | Sim, integralmente | Parcialmente (a parte de segurança só se prova com revisão) |

## Recomendação
**Fazer A agora, adiar B.** A cobre "criar novos nós reutilizáveis" e a documentação pedida sem abrir execução de código. B só depois de validar o motor no Windows e de você aceitar o risco explicitamente.

### Desenho de A (se aprovado)
1. **Formato** `*.asplugin.json` (versionado, `strictObject`): `id`, `name`, `version`, `description`, `fields[]` (mesmos tipos de `ConfigField`), `results[]`, `flow` (um `WorkflowDocument` cujas variáveis são os parâmetros — o mesmo contrato de "Chamar fluxo").
2. **Carga controlada:** importação manual (como a de fluxos): resumo → confirmação; nunca automática; instalado em `userData/plugins/`; **desativável/removível**; id não pode colidir com nós embutidos; limite de tamanho/quantidade.
3. **Validação:** schema + `validateWorkflow` do fluxo interno + checagem de que só usa nós embutidos (nada de plugin chamando plugin além de profundidade 5).
4. **Execução:** o nó do plugin vira uma chamada de subfluxo com o documento interno (reuso do código da ADR 0013); histórico mostra os passos internos.
5. **Documentação:** `docs/PLUGINS.md` com o formato e exemplos.

### Se B for escolhido (requisitos mínimos de segurança)
Desligado por padrão; opt-in **por plugin** com tela mostrando autor, arquivos e **hash SHA-256 fixado**; carga só de `userData/plugins` (nunca de caminho do fluxo); rejeitar plugin alterado depois do consentimento; processo separado do motor principal; sem acesso a segredos; sem carga durante execução de fluxo importado.

## Pergunta
Aprovar **A** (recomendado), **B**, **ambos em etapas** ou **nenhum por ora**?
