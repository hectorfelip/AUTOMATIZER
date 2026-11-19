# Instalador e distribuição (Fase 9)

Ferramenta: **electron-builder** (já prevista em `ARCHITECTURE.md`), alvo **NSIS x64** para Windows 11. Configuração: `apps/desktop/electron-builder.yml`.

## Gerar (no Windows, PowerShell, raiz do projeto)
```bash
py -3 -m venv .venv-engine
.\.venv-engine\Scripts\Activate.ps1
pip install -r engine\python\requirements-build.txt -r engine\python\requirements-windows.txt -r engine\python\requirements-web.txt -r engine\python\requirements-recorder.txt -r engine\python\requirements-vision.txt
python scripts\build-engine.py                      # motor congelado (só inclui o que estiver instalado: confira a linha "módulos opcionais incluídos") -> engine\python\dist\automation-engine\
npm ci
npm run package:win -w @automation-studio/desktop    # instalador em release\
```
O instalador leva o app (asar) e o **motor congelado em `resources\engine`** (o usuário final não precisa de Python). **Rebuilde o motor sempre que o código Python mudar**: o `electron-builder` copia o que estiver em `engine\python\dist`.

## Política de dados (decisão a validar)
| Evento | O que acontece com `%APPDATA%\Automation Studio` (banco, histórico, capturas de tela) |
|---|---|
| **Atualizar** (instalar versão nova por cima) | **Preservado.** O app aplica migrações versionadas ao abrir; nenhuma migração já aplicada é editada. |
| **Desinstalar** | **Preservado** (`deleteAppDataOnUninstall: false`): reinstalar recupera automações e histórico. Para apagar tudo, o usuário remove a pasta manualmente (documentado no guia). |
| Banco de versão **mais nova** que o app (ex.: voltou a uma versão antiga) | O app **recusa abrir**, não altera nada e explica ("atualize o aplicativo"). |
Instalação por usuário (`perMachine: false`): **não pede administrador**, e o app não deve rodar elevado.

## Assinatura
Sem certificado o instalador sai **não assinado** (SmartScreen mostrará "editor desconhecido"; PyInstaller também pode gerar falso positivo de antivírus). Com certificado: defina `CSC_LINK` e `CSC_KEY_PASSWORD` e remova `signAndEditExecutable: false`. Não há certificado neste projeto.

## O que foi verificado (Linux, `npm run package:dir`)
- O pacote é gerado e contém `app.asar` (~18 MB), `resources/engine` (motor congelado; ~34 MB medidos antes de incluir playwright/pillow, agora ~245 MB em Linux e 162 MB no Windows) e **nenhum teste** (`*.test.*`).
- **O app empacotado abre, acha sozinho o motor em `resources/engine` (sem repositório nem Python do dev), executa um fluxo e grava os dados em `userData`** (e2e `packaged.spec.ts`, roda se `release/linux-unpacked` existir).
- Migração com **dados reais** de uma versão antiga e recusa de banco de versão futura (testes).
- Memória em repouso (app empacotado, Linux/xvfb): **~493 MB** de working set somando os processos do Electron (Browser 164, GPU 137 — render de software do xvfb, Tab 114, Utility 78), **fora** do processo Python do motor. **Não otimizado; não medido no Windows nem durante execuções longas.**

## Verificado no Windows (Hector, 19/11)
- `npm run package:win` gera `release\win-unpacked` e o app empacotado (`release\win-unpacked\Automation Studio.exe`) **abre**. Antes do conserto da segunda abertura/falha de carga silenciosa (commit `7444d7d`) um instalador anterior "não abria"; causa não confirmada.
- Pendente de confirmar: o arquivo `release\Automation Studio Setup 0.0.0.exe` concluído, a instalação por ele, o Dashboard com motor **Disponível** no app empacotado e a desinstalação.

## O que NÃO foi verificado (precisa do Windows)
Build do instalador NSIS; instalar em Windows limpo; atalhos; desinstalar (e que os dados ficam); atualizar por cima sem corromper o banco real; o motor congelado **do Windows** iniciado pelo app instalado; SmartScreen/antivírus; DPI e múltiplas resoluções; apps elevados; agendador e `process.execPath` do app instalado; o motor congelado agora inclui playwright/pynput/OCR (~245 MB em Linux, ver `engine-packaging.md`; `verify-engine.py` já passou no Windows com pynput/winrt congelados) — conferir `verify-engine.py` e o tamanho do instalador.

## Roteiro de teste no Windows limpo
1. Gerar o instalador (acima) e instalá-lo numa máquina/VM **sem Python**.
2. Abrir: Dashboard com motor **Disponível**. Criar uma automação, executar **Organizar PDFs** num diretório de teste.
3. Fechar, **instalar de novo por cima** (mesma versão): automações e histórico continuam.
4. Desinstalar: confirme que `%APPDATA%\Automation Studio` continua; reinstalar e ver os dados.
5. Mudar a escala do Windows (125%/150%) e a resolução; usar "Clique" por coordenada (esperado: depende da escala).
6. Anotar qualquer aviso do SmartScreen/antivírus.
