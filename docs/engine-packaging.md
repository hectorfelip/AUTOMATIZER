# Spike de empacotamento do motor Python

**Objetivo (Fase 3):** provar que o motor vira um executável que roda **sem Python instalado** e que `pywinauto`/`pyautogui` entram nele. Descobrir agora, e não na Fase 9, se o PyInstaller briga com essas bibliotecas.

**Status:** ✅ validado em Linux (35 MB, handshake 0,05 s) **e no Windows** (Python 3.14.8, `pywinauto` 0.6.9 + `pyautogui` 0.9.54 importam dentro do executável congelado, handshake 0,61 s, 13/13 verificações com PATH sem Python). Ainda não exercitado no Windows: o Electron iniciando esse executável (`AUTOMATION_STUDIO_ENGINE`) e o modo dev com `py -3`.

## Passo a passo no Windows (PowerShell, na raiz do projeto)

O Python 3.11+ só é necessário aqui, para *gerar* o executável. O usuário final não precisará dele.

```bash
py -3 -m venv .venv-engine
.\.venv-engine\Scripts\Activate.ps1
pip install -r engine\python\requirements-build.txt -r engine\python\requirements-windows.txt
python scripts\build-engine.py
python scripts\verify-engine.py engine\python\dist\automation-engine\automation-engine.exe --clean-path
```

O `verify-engine.py` confere: o `.exe` roda, `pywinauto` e `pyautogui` **importam dentro do executável congelado**, handshake `ready`, `ping`, uma ação, cancelamento, `shutdown` e stdout limpo. `--clean-path` tira o Python do PATH para simular uma máquina sem Python. No fim ele imprime `PASSOU` ou lista o que falhou.

Teste opcional, o app inteiro usando o executável:

```bash
$env:AUTOMATION_STUDIO_ENGINE = "$PWD\engine\python\dist\automation-engine\automation-engine.exe"
npm run dev -w @automation-studio/desktop
```

No Dashboard, o card "Motor de automação" deve mostrar **Disponível**. Depois abra uma automação e use **Executar**.

## O que reportar
- A saída completa do `verify-engine.py` (e do `build-engine.py`, se falhar).
- Windows Defender ou SmartScreen bloqueou ou reclamou do `.exe`? (executáveis PyInstaller costumam gerar falso positivo.)
- Quanto tempo levou o handshake (`responde 'ready' — X s`) e quantos MB a pasta tem.

## Riscos a observar
- **Antivírus:** PyInstaller novo/não assinado pode ser sinalizado. Mitigação: assinar o instalador (Fase 9).
- **onedir vs onefile:** usamos `onedir` (inicia mais rápido, sem extrair a cada execução). `onefile` é um único arquivo, porém lento e mais sujeito a antivírus.
- **DPI:** `pyautogui` precisa declarar DPI awareness para coordenadas corretas (Fase 4).

## Onde o executável é procurado
`resources/engine/automation-engine(.exe)` no app instalado, ou o caminho em `AUTOMATION_STUDIO_ENGINE` (ver `docs/CONVENTIONS.md`).


## Bibliotecas opcionais no executável (aprovado pelo Hector)
`scripts/build-engine.py` agora inclui, quando instaladas no venv de build: `pillow`, `playwright` (`requirements-web.txt`), `pynput` (`requirements-recorder.txt`) e os `winrt-*` do OCR (`requirements-vision.txt`), além de pywinauto/pyautogui. Para o build completo no Windows, instale **todos** os arquivos de requisitos:

```bash
pip install -r engine\python\requirements-build.txt -r engine\python\requirements-windows.txt -r engine\python\requirements-web.txt -r engine\python\requirements-recorder.txt -r engine\python\requirements-vision.txt
python scripts\build-engine.py
python scripts\verify-engine.py engine\python\dist\automation-engine\automation-engine.exe --clean-path
```

`--selftest` importa, **dentro do executável congelado**, `PIL`, `playwright.sync_api`, `pynput.keyboard/mouse` e os módulos `winrt.windows.*` do OCR; o `verify-engine.py` falha se algum não importar (pynput e winrt só se aplicam ao Windows). O motor usa o **Edge/Chrome do sistema** (não embute Chromium).

**Evidência:** em **Linux** (Python 3.13) o executável com `pillow` + `playwright` foi gerado e passou no `verify-engine.py` (PIL e playwright importam congelados; handshake 0,08 s). **Custo: a pasta foi de 35 MB para ~245 MB** — o driver Node do playwright responde por ~161 MB (o instalador NSIS comprime, mas conte dezenas de MB a mais). Se o tamanho incomodar, o caminho é tirar o playwright do executável (nós "Navegador" voltam a responder `DEPENDENCY_MISSING`). **Windows (Hector, 19/11): `verify-engine.py --clean-path` passou em todas as verificações** com pywinauto, pyautogui, pillow, playwright, pynput e `winrt-*` congelados (tamanho da pasta no Windows: a informar). Ainda não exercitado: o app Electron iniciando esse `.exe` e o gravador/OCR/web rodando a partir dele.
