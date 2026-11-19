# Pendências que só o Hector pode resolver

Estado em Linux: Fases 0–6b, 7 (web), 8 (subfluxos) e 9 (empacotamento parcial) implementadas e testadas (`npm run check` e e2e verdes). Abaixo, **tudo que está parado** e o que fazer. Responda por item; "aprovado" basta.

## 1. ADRs 0009–0014 — ✅ APROVADOS pelo Hector
0009 (execução/histórico), 0010 (importar/exportar), 0011 (agendamento), 0012 (web/Playwright), 0013 (subfluxos) e 0014 opção A (plugins declarativos), mais a **política de dados do instalador** (`docs/INSTALLER.md`). Os pontos que dependem do Windows continuam não verificados (seção 3).

## 2. Decidir (propostas prontas, nada implementado)
| Tema | Documento | Recomendação |
|---|---|---|
| Plugins **com código** (opção B do [ADR 0014](adr/0014-plugins-de-acoes-proposta.md)) | mesmo ADR | A opção A está aprovada e implementada. A B **não** foi aprovada e só com os requisitos de segurança do ADR |
| OCR / reconhecimento visual | [ADR 0015](adr/0015-ocr-e-reconhecimento-visual-proposta.md) | Protótipo com **Windows.Media.Ocr**; rode `scripts/spike-ocr.py` no Windows |
| **Gravador** (Fase 7) | [ADR 0016](adr/0016-gravador-proposta.md) | Protótipo com `pynput` (rode `scripts/spike-recorder.py` no Windows); desenho com indicador sempre visível, modo senha, revisão antes de criar; decidir também se entra um nó "clicar em elemento UIA" |

## 3. Validar no Windows (nada disto roda no Linux)
1. `python -m pip install -r engine\python\requirements-windows.txt` e `python scripts\verify-actions.py` — arquivos 11/11 e abrir app **já passaram**; falta janela/teclado/mouse.
2. App em modo dev: Passo a passo, breakpoint, Pausar/Continuar, "a partir daqui", falha → Histórico, captura de tela (`docs/reviews/fase-5.md`).
3. Exportar/Importar com os diálogos reais (`docs/reviews/fase-6a.md`).
4. Agendamento "uma vez" em 2 min; ver a tarefa em `AutomationStudio` no Agendador do Windows (`docs/reviews/fase-6b.md`) — **só funciona no app instalado**.
5. Web: `pip install -r engine\python\requirements-web.txt`; fluxo Abrir página → Extrair com o Edge (`docs/reviews/fase-7-web.md`).
6. Instalador: `docs/INSTALLER.md` (gerar, instalar em máquina limpa, reinstalar por cima, desinstalar, DPI/resoluções, SmartScreen).
7. Se tiver certificado de assinatura, me diga como fornecer (`CSC_LINK`/`CSC_KEY_PASSWORD`).

## 4. Dívidas técnicas conhecidas (não bloqueiam)
Sem throttling de eventos IPC em laços enormes; breakpoints/ciclos de subfluxo só em execução; `playwright` fora do motor congelado; segredos (variável "segredo" que nunca vai ao histórico) não existe; memória medida (~493 MB em repouso), não otimizada.
