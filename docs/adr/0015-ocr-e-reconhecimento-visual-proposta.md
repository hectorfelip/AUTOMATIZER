# ADR 0015 — OCR e reconhecimento visual (Fase 8) — PROPOSTA

**Status:** proposta, **nada implementado**. `ARCHITECTURE.md §15` deixa o mecanismo de OCR **aberto até um protótipo em Windows real**; este ADR reúne as opções e um spike para você rodar. Roadmap: localizar texto na tela, localizar imagem de referência, esperar elemento visual; critério: **timeout e limiar de confiança configuráveis**. Posição na ordem de preferência de automação: *UIA > janela > Playwright > imagem/OCR > coordenadas*.

## Opções de OCR (texto na tela)
| Opção | Prós | Contras | Evidência hoje |
|---|---|---|---|
| **Windows.Media.Ocr** (WinRT, vem no Windows 10/11) | **Nada a embutir**, rápido, idiomas pelos pacotes do Windows (pt-BR) | Só Windows; depende do pacote de idioma instalado; binding Python (`winrt-*`) a empacotar | **Não testado** — spike abaixo |
| **Tesseract** (`pytesseract` + binário + `tessdata`) | Independe do Windows, bom controle de idioma/limiar | **~30–100 MB** a embutir, instalação do binário, empacotar com PyInstaller | Não instalado aqui; não testado |
| **EasyOCR / PaddleOCR** | Precisão | **Centenas de MB** e PyTorch/Paddle: inviável para o instalador | Descartada de saída |

**Recomendação:** protótipo com **Windows.Media.Ocr** (sem peso no instalador e alinhado ao alvo Windows); Tesseract como plano B se o idioma/precisão não bastar.

## Localizar imagem de referência
`pyautogui.locateOnScreen(img, confidence=…)` exige **OpenCV** (~60 MB) para o `confidence`; sem ele só há correspondência exata (frágil com DPI/tema). Alternativa leve: correspondência por **Pillow + numpy** (a avaliar). Qualquer opção depende de DPI/escala → só se valida no Windows.

## Desenho comum (quando houver mecanismo)
Nós `vision.find_text`, `vision.find_image`, `vision.wait_for`: `timeoutSeconds`, `confidence` (0–1, padrão 0.8), região opcional (absoluta), resultado `{x, y, width, height, confidence}`; erro `NOT_FOUND_ON_SCREEN` com o que foi procurado; **cancelamento cooperativo** nas esperas; nenhum texto lido é registrado no log sem o usuário ligar (pode conter dados sensíveis).

## O que fazer agora
Rodar `scripts/spike-ocr.py` no Windows (abaixo) e me mandar a saída. Com isso eu escrevo a implementação da opção que funcionar.

## Pergunta
Aprovar o **protótipo com Windows.Media.Ocr** (recomendado), preferir **Tesseract**, ou **adiar** OCR/visão?
