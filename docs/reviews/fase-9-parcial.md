# Revisão — Fase 9 (parcial, itens verificáveis em Linux)

| Item do roadmap | Estado |
|---|---|
| Revisar segurança do IPC | ✅ feito (abaixo) |
| Revisar armazenamento de segredos | ✅ revisado: nenhum segredo é armazenado hoje (sem campo de nó que os guarde); valores de variáveis vão ao histórico (documentado no guia e na revisão da Fase 5). Credential Manager: **não implementado** (não há necessidade até haver ações com credenciais) |
| Criar documentação de usuário | ✅ `docs/USER_GUIDE.md` |
| Criar notas de versão | ✅ `CHANGELOG.md` |
| Otimizar uso de memória | ⚠️ **não medido** (sem Windows/instalador); limites estruturais existem (2000 execuções, 5000 logs, prévia limitada do contexto) |
| Instalador, desinstalador, Windows limpo, DPI, resoluções, caminhos com acento, elevação, atualização sem corromper banco | ⏳ só no Windows (o banco já usa migrações versionadas e nunca edita migração aplicada) |

## Revisão de segurança do IPC/Electron
Conferido no código e por teste: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, `webSecurity` on; CSP restritiva; preload tipado e mínimo (e2e fixa as chaves); todo canal com zod `strictObject`; sender checado; renderer não informa caminhos (diálogos só no Main); capturas lidas apenas dentro da pasta de diagnóstico.

**Achado corrigido:** em produção `isTrustedUrl` aceitava **qualquer** `file://`; outro HTML local navegado dentro da janela herdaria o preload e o IPC. Agora só a `index.html` do app é confiável (`matchesAppFile`, 10 testes) e há e2e que tenta navegar para `file://` e `https://` e confirma que o app não sai da página. Também: `will-redirect` e `will-attach-webview` bloqueados; `setPermissionCheckHandler` nega tudo.

**Resíduos/riscos:** o IPC assume um renderer único; links `http(s)` abrem no navegador padrão sem confirmação (aceitável: o app não renderiza conteúdo de terceiros). Não verificado: comportamento do instalador/assinatura de código.
