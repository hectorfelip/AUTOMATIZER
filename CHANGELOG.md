# Notas de versão

## [Não lançada] — MVP em desenvolvimento (0.x)
Linux verificado; **ações de arquivo, abrir app, janela, teclado e mouse validadas no Windows** (`verify-actions.py`). Demais itens de Windows pendentes, marcados em `docs/reviews/`.

### Adicionado
- **Fase 8 (OCR):** nó "Localizar texto na tela" (Windows.Media.Ocr, similaridade e timeout configuráveis, região opcional; ADR 0015). Spike validado no Windows; **a ação real ainda não foi rodada lá**. Localizar imagem não existe.
- **Fase 8 (plugins):** plugins **declarativos** (nós novos por composição de nós embutidos, sem código), instalação manual com resumo, ativar/desativar/remover (ADR 0014 opção A, `docs/PLUGINS.md`). Plugins com código **não** existem.
- **Fase 9 (parcial):** configuração do instalador NSIS (electron-builder), motor congelado em `resources/engine`, política de dados preservados, recusa de banco de versão futura, teste de atualização com dados reais (`docs/INSTALLER.md`). **Instalador não gerado/testado no Windows.**
- **Fase 8 (parcial):** nó "Chamar fluxo" (subfluxos com parâmetros e retorno pelas variáveis do fluxo chamado, sem mudar o schema), exemplo web na biblioteca de templates (ADR 0013). OCR, reconhecimento visual e plugins **não** implementados.
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
Instalador ainda não gerado no Windows; gravador (7), OCR/imagem/plugins (8). Ver `docs/USER_GUIDE.md §8`.
