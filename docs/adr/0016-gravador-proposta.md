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


## Implementação (sob a diretriz `/goal`; spike validado no Windows)
- **Processo separado** `automation-engine --record` (mesmo executável do motor; `engine/python/automation_engine/recorder.py`), com `pynput` (`requirements-recorder.txt`). **Sem mudança no protocolo do motor**: o gravador tem o próprio fluxo JSON Lines no stdout, lido só pelo Main.
- **Privacidade (testada):** eventos só em **memória** do Main; nada em disco/log/histórico; stderr do gravador é descartado. **Modo senha** (`Ctrl+Alt+S`): o processo **nunca emite o caractere** (só "houve tecla"); o fluxo gerado usa `{{variables.senha}}` (variável vazia). Controles globais nunca são gravados: `Ctrl+Alt+R` para, `Ctrl+Alt+P` pausa, `Ctrl+Alt+S` senha. Testes: o texto digitado em modo senha não aparece em stdout, stderr, tela, banco de dados nem no fluxo.
- **Indicador:** faixa vermelha sempre visível (janela `alwaysOnTop`, sem foco, que **não captura cliques**) enquanto grava; o app minimiza ao iniciar e restaura ao parar.
- **Conversão:** digitação agrupada em um passo; duplo clique; atalhos (`input.hotkey`); Backspace apaga o caractere em vez de virar passo; pausas ≥ 1 s viram `flow.wait` (≤ 60 s); cliques viram `input.click` **por coordenada** (o gravador não detecta elemento; o nó `windows.click_element` existe e pode substituí-los na revisão manual). Limites: 20 000 eventos, 500 passos.
- **Revisão antes de criar:** tela com edição, remoção e reordenação dos passos; "Criar automação" valida o fluxo (erros impedem) e **nunca executa**; "Descartar" apaga tudo da memória.
- **Só descarta o clique no botão do próprio app** (Pausar/Parar), recente e último; cliques reais em qualquer lugar da tela são mantidos (uma versão inicial filtrava por posição e engoliria cliques de quem grava em outro programa — corrigido).

## Correções após o 1º teste no Windows
`write EPIPE` ao parar por Ctrl+Alt+R (pipe de um processo já encerrado sem tratador de erro) e auditoria dos atalhos/digitação: o processador usa o **caractere produzido** para texto e a **tecla-base** só para atalhos; **AltGr** (ABNT2: `/` = AltGr+Q) é tratado à parte e nunca vira atalho. Ver `docs/reviews/fase-7-gravador.md`.

## Não verificado (precisa do Windows)
Captura real de teclado/mouse **dentro do app** (o spike validou o `pynput`; o e2e usa uma fonte falsa de eventos); a **faixa vermelha, minimizar ao iniciar e restaurar ao parar** (essas operações nativas ficam desligadas no e2e: sem gerenciador de janelas elas travavam o processo principal); os atalhos globais com `pynput` + `canonical()` (letras com Ctrl pressionado); empacotar `pynput` no motor congelado.
