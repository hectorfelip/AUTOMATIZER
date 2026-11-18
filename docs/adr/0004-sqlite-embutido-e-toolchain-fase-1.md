# ADR 0004 — SQLite embutido (`node:sqlite`) e toolchain da Fase 1

**Status:** aceita (aprovada pelo Hector; app validado no Windows)

## Contexto
`ARCHITECTURE.md` diz apenas "SQLite". As bibliotecas comuns (`better-sqlite3`) são módulos nativos: cada Electron exige recompilação (ABI), e o mesmo `node_modules` não serve ao Electron e ao Vitest ao mesmo tempo.

## Decisões
1. **`node:sqlite`** (embutido). Verificado: roda no Electron 45 (Node 24.22) e no Node 22 dos testes, com a mesma API e sem build nativo. **Risco:** a API ainda é marcada como experimental/em desenvolvimento pelo Node; mudanças de API entre versões do Electron são possíveis. Mitigação: todo acesso a banco passa por `src/main/database` e `src/main/services` (superfície pequena). Alternativa: `better-sqlite3` + `electron-rebuild` + passo separado para testes.
2. **Migrações** em `/database/migrations` (como no doc), carregadas via `import.meta.glob(?raw)` e aplicadas por `PRAGMA user_version`, cada uma em transação. A `0001` cria só `automations` e `settings`; as demais tabelas do doc entram na fase que as usa.
3. **Vite 7** (não 8): `@vitejs/plugin-react@6` exige Vite 8/rolldown, enquanto Vitest 3 e electron-vite 6 usam Vite 7; duas versões quebram a tipagem de plugins. Usamos Vite 7 + `plugin-react@5`. Reavaliar ao atualizar o Vitest.
4. **`shared-types`** passa a ser consumido como código-fonte TS (sem build próprio) e embutido no bundle do Main/Preload; schemas zod ficam em arquivo separado para não entrar no bundle do renderer.
5. **IPC**: canais fixos, argumentos validados com zod (`strictObject`), checagem da URL do frame remetente, resultado `{ok,data}|{ok,error}` com mensagens seguras; erros inesperados viram `INTERNAL` genérico e vão para o log.

## Consequências
Sem compilação nativa no Windows nem no CI. Se `node:sqlite` mudar, o impacto fica isolado em dois diretórios.
