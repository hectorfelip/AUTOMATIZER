# Pendências que só o Hector pode resolver

Estado em Linux: Fases 0–6b, 7 (web), 8 (subfluxos) e 9 (empacotamento parcial) implementadas e testadas (`npm run check` e e2e verdes). Abaixo, **tudo que está parado** e o que fazer. Responda por item; "aprovado" basta.

## 1. ADRs 0009–0014 — ✅ APROVADOS pelo Hector
0009 (execução/histórico), 0010 (importar/exportar), 0011 (agendamento), 0012 (web/Playwright), 0013 (subfluxos) e 0014 opção A (plugins declarativos), mais a **política de dados do instalador** (`docs/INSTALLER.md`). Os pontos que dependem do Windows continuam não verificados (seção 3).

## 2. Decidir (propostas prontas, nada implementado)
| Tema | Documento | Recomendação |
|---|---|---|
| Plugins **com código** (opção B do [ADR 0014](adr/0014-plugins-de-acoes-proposta.md)) | mesmo ADR | A opção A está aprovada e implementada. A B **não** foi aprovada e só com os requisitos de segurança do ADR |
| OCR / reconhecimento visual | [ADR 0015](adr/0015-ocr-e-reconhecimento-visual-proposta.md) | ✅ spike validado; `vision.find_text` implementado. **Rode `python scripts\verify-vision.py "texto visível"` no Windows.** **Decidido: Pillow** (sem OpenCV). `vision.find_image` implementado e **em espera** (Hector, 19/11): o teste real falhou por o recorte ser uma imagem exibida a 69% na tela (casa pixels na mesma escala); aberta a opção "tolerar tamanhos diferentes" (multi-escala, desligada por padrão). Teste correto: recorte da própria tela com `Win+Shift+S` |
| **Gravador** (Fase 7) | [ADR 0016](adr/0016-gravador-proposta.md) | ✅ implementado (spike validado). **Valide no Windows:** `pip install -r engine\python\requirements-recorder.txt` e `npm run dev` → Gravador (faixa vermelha, minimizar/restaurar, Ctrl+Alt+R/P/S). O nó `windows.click_element` (UIA) existe; o gravador ainda gera cliques por coordenada (detectar o elemento sob o clique é trabalho futuro). **Valide:** `python scripts\verify-uia.py` |

## 3. Validar no Windows (nada disto roda no Linux)
1. ✅ `verify-actions.py` **passou por inteiro no Windows** (arquivos, abrir app, janela/teclado/mouse) — Fase 4 validada. Falta só DPI/escalas e apps elevados.
2. App em modo dev: Passo a passo, breakpoint, Pausar/Continuar, "a partir daqui", falha → Histórico, captura de tela (`docs/reviews/fase-5.md`).
3. Exportar/Importar com os diálogos reais (`docs/reviews/fase-6a.md`).
4. Agendamento "uma vez" em 2 min; ver a tarefa em `AutomationStudio` no Agendador do Windows (`docs/reviews/fase-6b.md`) — **só funciona no app instalado**.
5. Web: `pip install -r engine\python\requirements-web.txt`; fluxo Abrir página → Extrair com o Edge (`docs/reviews/fase-7-web.md`).
6. Instalador: `docs/INSTALLER.md` (gerar, instalar em máquina limpa, reinstalar por cima, desinstalar, DPI/resoluções, SmartScreen).
7. Se tiver certificado de assinatura, me diga como fornecer (`CSC_LINK`/`CSC_KEY_PASSWORD`).

## 4. Dívidas técnicas conhecidas (não bloqueiam)
Sem throttling de eventos IPC em laços enormes; breakpoints/ciclos de subfluxo só em execução; playwright/pynput/OCR incluídos no motor congelado (aprovado; custo: pasta de 35 MB → 162 MB no Windows; `verify-engine.py` passou no Windows, incluindo pynput/winrt congelados; falta o app iniciando o .exe); segredos (variável "segredo" que nunca vai ao histórico; Credential Manager via motor com ctypes, conforme ARCHITECTURE §9) **adiados por decisão do Hector (19/11)** — hoje o modo senha do gravador gera `{{variables.senha}}` vazia e quem digita uma senha num nó a deixa no fluxo/histórico; memória medida (~493 MB em repouso), não otimizada.
