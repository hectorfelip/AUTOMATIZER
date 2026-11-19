# Notas de versão

## [Não lançada] — MVP em desenvolvimento (0.x)
Linux verificado; Windows pendente nos itens marcados em `docs/reviews/`.

### Adicionado
- **Fase 7 (web):** nós Navegador (abrir, clicar, preencher, extrair, esperar, fechar) com Playwright; sessão por execução fechada ao fim; cancelamento rápido (ADR 0012). Gravador **não** implementado.
- **Fase 6b:** agendamentos (única, diária, semanal, ao entrar) via Agendador de Tarefas do Windows; disparo por `--run-automation`; próxima/última execução; histórico marca execuções agendadas (ADR 0011). **Registro no Windows não verificado.**
- **Fase 6a:** exportar/importar fluxos (JSON versionado), com resumo antes de importar; importar nunca executa (ADR 0010).
- **Fase 5:** painel de execução, pausa/continuar/passo a passo, breakpoints, executar a partir de um nó, visualizador de variáveis, política de erro "continuar" (concluída com avisos), histórico e logs persistentes com filtros, captura de tela opcional (ADR 0009).
- **Fase 4:** ações de arquivos, janelas, teclado e mouse; condição, repetição e "Para cada item"; resultados de nós em expressões (ADR 0007, 0008).
- **Fase 3:** motor Python com protocolo JSON Lines e interpretador (ADR 0006).
- **Fases 1–2:** Dashboard, CRUD de automações, editor visual com validação e versões imutáveis (ADR 0004, 0005).

### Segurança
- Navegação só para a própria página do app (antes, qualquer `file://` seria aceito como origem confiável do IPC); bloqueio de `<webview>`, redirecionamentos e checagem de permissões.

### Conhecido
Sem instalador, gravador (7), OCR/plugins/subfluxos (8). Ver `docs/USER_GUIDE.md §8`.
