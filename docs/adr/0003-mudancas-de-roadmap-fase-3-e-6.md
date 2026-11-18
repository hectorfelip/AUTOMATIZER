# ADR 0003 — Spike de empacotamento na Fase 3 e divisão da Fase 6

**Status:** aceita (aprovada pelo Hector)

## Contexto
1. O empacotamento do motor Python só era validado na Fase 9; incompatibilidades (PyInstaller × pywinauto/PyAutoGUI) apareceriam tarde.
2. A Fase 6 misturava importação/exportação (obrigatória no MVP) com agendamento (não listado como obrigatório), atrasando o MVP.

## Decisão
1. Adicionar spike de empacotamento e critério de aceite correspondente à Fase 3.
2. Dividir a Fase 6 em 6a (importar/exportar, MVP) e 6b (agendamento, pós-MVP).

## Consequências
Risco de empacotamento descoberto cedo, mas validável só em Windows real (depende do Hector). MVP não espera o agendador. `DEVELOPMENT_ROADMAP.md` já atualizado.
