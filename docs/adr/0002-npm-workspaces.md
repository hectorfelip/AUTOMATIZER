# ADR 0002 — npm workspaces para o monorepo

**Status:** aceita

## Contexto
O roadmap (Fase 0) pede monorepo ou workspaces. A arquitetura prevê `apps/desktop` e vários pacotes em `packages/`.

## Decisão
Usar npm workspaces (`apps/*`, `packages/*`), sem pnpm/Turborepo/Nx. Motor Python fica fora dos workspaces em `engine/python`, com `pyproject.toml` próprio. Pacotes são criados quando necessários, não todos de uma vez; hoje existe só `shared-types`.

## Consequências
Zero ferramenta extra. Se builds ficarem lentos ou o grafo de dependências crescer, reavaliar pnpm/Turborepo (via Regra 3).
