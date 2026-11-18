# CLAUDE.md — Automation Studio

Aplicativo desktop (Windows 11) para criar, executar e monitorar automações por fluxos visuais. Local-first, sem servidor.

## Documentos-base (fonte do escopo)

| Documento | Conteúdo |
|---|---|
| `docs/PROJECT_SPEC.md` | O quê: visão, escopo funcional, requisitos, critérios de aceite do MVP |
| `docs/ARCHITECTURE.md` | Como: stack, processos, schema do fluxo, protocolo Node↔Python, banco, segurança |
| `docs/DEVELOPMENT_ROADMAP.md` | Quando: fases 0–9, critérios de aceite por fase, DoD, riscos |

Em caso de conflito entre documentos, **pare e pergunte** — não escolha sozinho.

**Resumo da arquitetura:** Electron Main (ciclo de vida, IPC, SQLite) ↔ Renderer React/TS (UI, React Flow só edita o grafo, não executa) ↔ Motor Python (ações) via JSON Lines em stdin/stdout. Node orquestra e interpreta; Python executa.

## Regra 1 — O escopo é ponto de partida, não teto

Os três documentos definem o escopo inicial, mas **não limitam** o projeto. Mudanças são bem-vindas desde que **comprovadamente úteis ao código** (ver Regra 3 para o que conta como prova).

## Regra 2 — Desenvolvimento em fases

- Seguir as fases do `DEVELOPMENT_ROADMAP.md` em ordem (0 → 9).
- **Não iniciar uma fase sem que os critérios de aceite da anterior tenham sido demonstrados** (roadmap §8). "Demonstrado" = executado/testado de fato, não "deve funcionar".
- Cada fase termina com algo executável e testável (entregas verticais). Nada de IA, OCR ou gravador antes do ciclo criar → validar → executar → logar estar provado.
- Respeitar a Definition of Done do roadmap (§5) em toda funcionalidade.

## Regra 3 — Melhorias e mudanças: PERGUNTAR ANTES

Qualquer coisa que **desvie** dos três documentos exige aprovação do Hector **antes** de ser aplicada. Isso inclui: trocar biblioteca/tecnologia, alterar schema/protocolo/banco, adicionar ou remover escopo, reordenar fases, mudar estrutura de diretórios.

Como propor (curto, direto):
1. **O que** muda e **onde** o documento diverge.
2. **Por quê** — evidência concreta: protótipo, teste, benchmark, bug reproduzido, limitação documentada da lib/Windows. "Acho melhor" não é evidência.
3. **Custo/risco** e alternativa de não mudar.

Só aplicar após resposta. Aprovada a mudança, **atualizar o documento afetado em `docs/`** no mesmo trabalho, para os docs nunca divergirem do código.

Sem pedir permissão (não são desvios): detalhes de implementação dentro do contrato dos docs, refatoração local, testes adicionais, correção de bug.

## Regra 4 — Revisão cumulativa

Revisão acontece em dois níveis:

**A cada entrega (código, ideia, decisão):** auto-revisão contra o escopo antes de dar como pronto — está nos docs? valida entrada? tem estados de sucesso/erro/cancelamento? tem teste? quebrou algo existente?

**Ao fim de cada fase, revisão cumulativa:**
- Fim da Fase 1 → revisar Fase 1.
- Fim da Fase 2 → revisar Fases 1 **e** 2.
- Fim da Fase 3 → revisar Fases 1, 2 **e** 3.
- ...e assim por diante. A fase N revisa 1..N.

A revisão compara o código real com: critérios de aceite de cada fase, DoD, `ARCHITECTURE.md` (contratos, segurança, protocolo) e `PROJECT_SPEC.md` (requisitos). Rodar os testes e **executar** o que foi construído — não revisar só lendo.

Entregar relatório curto com: critérios atendidos / não atendidos, desvios dos docs, regressões, débitos técnicos, mudanças propostas (que seguem a Regra 3). Só avançar de fase com aprovação do Hector.

## Invariantes (não negociar sem passar pela Regra 3)

- **Segurança Electron:** `contextIsolation` on, `nodeIntegration` off, preload mínimo e tipado, todo argumento de IPC validado, sem API genérica de fs/shell no renderer.
- **Sem `eval`** nem execução de expressão arbitrária vinda do fluxo; expressões por mecanismo limitado e tipado.
- **Protocolo:** stdout do Python é exclusivo do protocolo (JSON Lines); diagnóstico vai para stderr. Validar tamanho/formato das mensagens.
- **Importação nunca executa automaticamente.** Validar schema e versão; rejeitar o desconhecido.
- **Segredos** só no Windows Credential Manager — nunca em `definition_json`, logs ou exportações.
- **Ações destrutivas** (excluir, sobrescrever) exigem confirmação e são testadas só em diretórios temporários.
- **Sem shell arbitrário no MVP;** lista explícita de ações permitidas.
- **Fluxo é JSON versionado**; dados visuais separados da config executável.
- **Prioridade de automação de UI:** UI Automation > janela/processo > Playwright > imagem/OCR > coordenadas (último recurso).
- Decisões listadas em `ARCHITECTURE.md` §15 (lib de automação Windows, OCR, agendamento, etc.) ficam abertas até haver protótipo em Windows real.

## Ambiente e verificação

- O desenvolvimento ocorre em container **Linux**; o alvo é **Windows**. Lógica pura (schema, validador, interpretador, protocolo, banco) é testável aqui. Ações de mouse/teclado/janelas/UI Automation, DPI, instalador e agendador **não são verificáveis aqui** — marcar como "não verificado em Windows" e pedir ao Hector para validar na máquina real. Nunca declarar pronto o que só foi lido, não executado.
- Comandos de build/test/lint serão documentados aqui assim que a Fase 0 os definir (critério de aceite da Fase 0).

## Convenções de trabalho

- Idioma: português para docs e conversa; identificadores de código em inglês.
- Não commitar nem abrir PR sem pedido explícito. Branch de desenvolvimento: `claude/admiring-maxwell-wp416y`.
- Preferir o menor código que cumpre o critério de aceite; sem abstração especulativa. Deixar `ponytail:`/TODO apenas quando houver limite conhecido e caminho de upgrade.
