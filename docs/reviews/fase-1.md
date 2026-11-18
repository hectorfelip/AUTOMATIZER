# Revisão — Fase 1 (Shell desktop e persistência)

Escopo revisado: Fases 0–1 (cumulativo, Regra 4). Verificação: `npm run check` ✅ (32 testes Vitest, 1 pytest, lint, typecheck, build) e `npm run test:e2e` ✅ (5 testes, Electron 45 real sob xvfb/Linux).

## Critérios de aceite da Fase 1

| Critério | Status | Evidência |
|---|---|---|
| Aplicativo abre como programa desktop | ⚠️ Linux ✅ / **Windows não verificado** | e2e abre a janela Electron; falta o Hector confirmar no Windows 11 |
| Criar, renomear, arquivar, excluir | ✅ | `e2e/app.spec.ts` (CRUD completo + restaurar + cancelar exclusão) |
| Dados persistem após fechar e abrir | ✅ | e2e fecha e reabre com o mesmo diretório (automação e tema) |
| Renderer sem acesso irrestrito ao Node | ✅ | e2e: `require`/`process`/`ipcRenderer` indefinidos; API exposta = 3 grupos; `contextIsolation` on, `nodeIntegration` off; CSP sem `unsafe-eval` |

## Critérios da Fase 0 (revisados)
Instalação, build, lint e testes por comando documentado: ✅ (`docs/CONVENTIONS.md`). `npm ci` do zero testado.

## Conformidade com ARCHITECTURE.md §10 (segurança Electron)
✅ contextIsolation · ✅ nodeIntegration off · ✅ preload mínimo/tipado · ✅ argumentos validados (zod strict + testes de entrada inválida) · ✅ sem fs/shell genérico · ✅ navegação/janelas novas bloqueadas, permissões negadas · ✅ CSP · ⚠️ `sandbox: true` está configurado, mas os testes rodam com `--no-sandbox` (Linux/root), então não é verificado por teste.

## Bug encontrado e corrigido durante a revisão
O plugin que relaxa o CSP só no dev server tinha regex que não casava com a tag em várias linhas → `npm run dev` teria o HMR bloqueado. Corrigido e verificado (dev: 0 CSP; produção: CSP presente).

## Desvios / decisões que precisam de aprovação (Regra 3)
1. **`node:sqlite`** em vez de lib nativa — ver ADR 0004 (risco: API ainda marcada experimental).
2. **Vite 7** em vez de 8 — ADR 0004.
3. **Migração 0001 só com `automations` e `settings`** (doc lista mais tabelas; entram nas fases que as usam).

## Escopo do SPEC ainda não coberto (fora dos critérios da Fase 1)
Duplicar, favoritar, categoria/tags/ícone na UI (colunas category/icon já existem no banco), versão do documento, importar/exportar (6a). Dashboard mostra contagens e indicador do motor; execuções recentes/sucessos/falhas dependem das fases 3–5.

## Débitos técnicos
- Sem backup do banco antes de migrar (Fase 9 trata atualização segura).
- Sem testes de componente no renderer (e2e cobre os fluxos); considerar se a UI crescer na Fase 2.
- Bundle do renderer ~660 kB (React 19); irrelevante para app local, medir na Fase 9.
- Dev mode validado só até "servidor sobe + Electron inicia" (sem interação).

## Não verificável aqui (precisa do Hector no Windows)
Janela/menu nativos, fonte Segoe UI, `userData` em `%APPDATA%`, DPI, instância única, `npm install` do Electron.
