# ADR 0016 — Gravador de mouse e teclado (Fase 7) — PROPOSTA

**Status:** spike **APROVADO no Windows** (49 eventos capturados com `pynput`); implementação **em andamento sob a diretriz `/goal`**. Depende de protótipo em Windows real (`ARCHITECTURE §15`). Roadmap: capturar mouse/teclado, **indicador visual de gravação**, pausa e parada, converter em **nós editáveis**, **excluir ou mascarar campos sensíveis**. Critérios: a gravação é **revisada antes de virar fluxo** e o usuário pode **corrigir** as ações geradas.

## Risco principal: é um keylogger por construção
Um gravador captura teclas globais. Por isso o desenho precisa garantir **consentimento, visibilidade e descarte**, não só funcionar:
1. **Só grava com indicador sempre visível** (janela/barra "● Gravando" sempre no topo, fora da área gravada) e botões Pausar/Parar; nunca em segundo plano.
2. **Nada persiste antes da revisão:** os eventos ficam **só em memória** até o usuário aceitar; cancelar descarta tudo.
3. **Campos sensíveis:** durante a gravação, um atalho (ex.: Ctrl+Alt+S) liga/desliga o **modo senha**: as teclas digitadas nesse intervalo **não são guardadas** (vira um passo "digitar texto" **vazio e marcado como sensível**, para o usuário preencher com variável). Detecção automática de campo de senha via UI Automation (`IsPassword`) como reforço.
4. **Texto nunca vai para log nem histórico** durante a gravação; a tela de revisão mostra o que foi capturado e permite apagar passos.

## Como capturar (Windows)
| Opção | Prós | Contras |
|---|---|---|
| `pynput` (listener global) | API simples, mouse+teclado, bem usada | Mais uma dependência; empacotar com PyInstaller a validar |
| `ctypes` + `SetWindowsHookEx` (WH_MOUSE_LL / WH_KEYBOARD_LL) | Sem dependência | Mais código e cuidado (loop de mensagens, thread dedicada) |
| `pyautogui` | Já usado | **Só gera** eventos, não captura |
**Recomendação:** protótipo com `pynput` (spike `scripts/spike-recorder.py`); se empacotar mal, `ctypes`.

## Conversão em nós (preferência da arquitetura)
Prioridade: **UI Automation > janela > coordenadas** (último recurso). O gravador deve, ao clicar, tentar identificar a **janela** (título) e o **elemento** (UIA: nome/AutomationId) e gerar:
`windows.activate_window` (título) → `input.type_text` / `input.hotkey` → `input.click` (**coordenadas só se não houver elemento**, com aviso de fragilidade por DPI). Esperas entre passos a partir dos intervalos medidos (arredondados, editáveis). Cliques agrupados, digitação contínua agrupada em um `type_text`, teclas de atalho viram `input.hotkey`.
Hoje **não existe nó de clique por elemento UIA** (só `input.click` por coordenada): isso é um escopo a decidir.

## Revisão antes de virar fluxo
Tela de revisão: lista de passos (tipo, alvo, texto mascarado), editar/remover/reordenar, "Gravar de novo", e só então **"Criar automação"** (nova automação com o fluxo gerado e valida pelo validador comum). Nunca executa ao criar.

## Fora do escopo
Gravar vídeo/tela; gravar dentro de aplicativos elevados (o Windows impede); gravar navegador por elementos (usar os nós web/Playwright; um "gravador web" com `playwright codegen` é outra proposta).

## O que fazer agora
Rodar `scripts/spike-recorder.py` no Windows (deixa 10 s capturando e imprime eventos) e me mandar a saída. Responder: **aprovar o protótipo**, **aprovar também o nó "clicar em elemento UIA"**, ou **adiar o gravador**.


## Resultado do spike (Windows 10 build 19045, Python 3.14.8, executado pelo Hector)
`pynput` instalou e capturou **49 eventos em 10 s** (cliques com posição, teclas pressionadas/soltas, rolagem). **Decisão:** `pynput`. O spike não mostra as teclas digitadas; a implementação também não as persiste fora da memória até a revisão.
