# Convenções

## Comandos (raiz do repositório)

Pré-requisitos: Node ≥ 22 e **Python ≥ 3.11 com `pytest`** (necessário também para os testes de integração Node↔Python e para os e2e: o motor é iniciado de verdade).

| Comando | O que faz |
|---|---|
| `npm install` / `npm ci` | Instala dependências (workspaces). O `postinstall` da raiz roda `install-electron` (a partir do Electron 45 o pacote não baixa o binário sozinho; sem isso o dev falha com `Electron uninstall`) |
| `npm run dev` (em `apps/desktop`) | Abre o app em modo desenvolvimento com HMR |
| `npm run build` | Compila o app (`apps/desktop/out/`) |
| `npm run lint` | ESLint (TypeScript) |
| `npm run typecheck` | `tsc --noEmit` em todos os workspaces |
| `npm test` | Vitest (unitário/integração: banco, serviços, IPC) |
| `npm run test:py` | pytest (motor Python) |
| `npm run check` | lint + typecheck + build + test + test:py — rodar antes de todo commit |
| `npm run test:e2e` | Compila e roda o app Electron real com Playwright. **Exige tela**: no Windows roda direto; em Linux sem display use `xvfb-run -a npm run test:e2e` |

### Motor Python

| Comando / variável | O que faz |
|---|---|
| `python scripts/build-engine.py` | Gera o executável do motor (PyInstaller) em `engine/python/dist/` — ver `docs/engine-packaging.md` |
| `python scripts/verify-actions.py [--title "Bloco de Notas"]` | Exercita as ações de verdade (arquivos automático; no Windows, Bloco de Notas com confirmação visual) |
| `python scripts/verify-engine.py <exe> [--clean-path]` | Verifica um executável do motor (protocolo, cancelamento, imports) |
| `AUTOMATION_STUDIO_PYTHON` | Python a usar em desenvolvimento (padrão: `py -3` no Windows, `python3` nos demais) |
| `AUTOMATION_STUDIO_ENGINE` | Caminho de um executável do motor (vence tudo; usado para validar o empacotamento) |
| `AUTOMATION_ENGINE_TEST_ACTIONS=1` | Habilita ações de teste (travar, cair, poluir stdout). **Só em testes, nunca em produção** |

Protocolo: `docs/PROTOCOL.md`.

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
