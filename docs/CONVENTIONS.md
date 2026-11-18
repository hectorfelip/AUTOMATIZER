# Convenções

## Comandos (raiz do repositório)

Pré-requisitos: Node ≥ 22, Python ≥ 3.11 com `pytest`.

| Comando | O que faz |
|---|---|
| `npm install` / `npm ci` | Instala dependências (workspaces). O postinstall do Electron baixa o binário |
| `npm run dev` (em `apps/desktop`) | Abre o app em modo desenvolvimento com HMR |
| `npm run build` | Compila o app (`apps/desktop/out/`) |
| `npm run lint` | ESLint (TypeScript) |
| `npm run typecheck` | `tsc --noEmit` em todos os workspaces |
| `npm test` | Vitest (unitário/integração: banco, serviços, IPC) |
| `npm run test:py` | pytest (motor Python) |
| `npm run check` | lint + typecheck + build + test + test:py — rodar antes de todo commit |
| `npm run test:e2e` | Compila e roda o app Electron real com Playwright. **Exige tela**: no Windows roda direto; em Linux sem display use `xvfb-run -a npm run test:e2e` |

## Código

- Identificadores, comentários técnicos e commits em inglês; docs e conversa em português.
- TypeScript `strict`. Testes ao lado do código: `*.test.ts` (Vitest) e `engine/python/tests/` (pytest).
- `.editorconfig` define indentação (2 espaços; 4 em Python), LF e newline final.
- Formatação automática (Prettier/ruff) não adotada ainda — adicionar se o estilo divergir.

## Branches

- `main`: sempre passa em `npm run check`.
- Trabalho em `feat/<nome>`, `fix/<nome>`, `docs/<nome>`; integrar em `main` após `check` verde.
- Sessões do Claude usam a branch `claude/*` designada.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Uma mudança lógica por commit. Sem enforcement automático (commitlint) por ora.

## Versionamento

SemVer. Versão `0.x` até o MVP ser aceito; `1.0.0` = MVP. Versão única da aplicação; o schema de workflow tem versão própria (`schemaVersion`) e migrações explícitas.

## Decisões arquiteturais

Registradas em `docs/adr/NNNN-titulo.md` (formato: Contexto, Decisão, Consequências). Mudança que desvia dos três documentos-base exige aprovação (ver `CLAUDE.md`, Regra 3) e vira ADR.
