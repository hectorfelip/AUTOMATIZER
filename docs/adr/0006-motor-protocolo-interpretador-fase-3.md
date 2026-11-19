# ADR 0006 — Motor Python, protocolo e interpretador (Fase 3)

**Status:** aceita (aprovada pelo Hector; spike de empacotamento validado no Windows)

## Decisões
1. **Protocolo v1** especificado em `docs/PROTOCOL.md` (detalha `ARCHITECTURE.md §8`: acrescenta `eventId`, `ready`, `ping/pong`, `cancel/cancel_ack`, `shutdown/bye`, `protocol_error`). JSON Lines, linha ≤ 1 MiB, stdout exclusivo do protocolo (o motor aponta `sys.stdout` para stderr). **O Node também valida** (zod) tudo que vem do motor.
2. **Motor só com biblioteca padrão** do Python (zero dependências de runtime; `pywinauto`/`pyautogui` entram na Fase 4). Python ≥ 3.11 verificado no handshake.
3. **Divisão de trabalho:** o interpretador (Node) executa `trigger.manual` e `flow.end` e resolve `{{variables.x}}` (valor tipado conforme o campo de destino); **todo o resto vai ao motor**. Condição, repetição e definir variável serão tratados pelo interpretador na Fase 4.
4. ⚠️ **`flow.wait` já implementado no motor** (consta na Fase 4). Necessário para demonstrar progresso, cancelamento cooperativo e timeout com um nó real.
5. ⚠️ **`execution-manager` não é pacote separado** (`ARCHITECTURE.md §4`): vive em `apps/desktop/src/main/services/executions.ts`, pois depende do cliente do motor e do IPC. O interpretador é o pacote puro `workflow-interpreter`.
6. **Resiliência:** heartbeat 5 s (3 sem resposta = motor morto e reiniciado); queda = reinício com recuo, até 3 em 60 s e depois `unavailable` com o último erro; ação que ignora o cancelamento por 3 s → o motor é morto e reiniciado ("quando tecnicamente possível", `ARCHITECTURE.md §7.4`); `before-quit` pede `shutdown` (até 2 s) antes de matar.
7. ⚠️ **Ações de teste no motor** (`test.crash`, `test.hang`, `test.noise`...) só carregam com `AUTOMATION_ENGINE_TEST_ACTIONS=1`. Existem para provar os caminhos de falha de verdade; nunca ligadas em produção.
8. **Execução roda o rascunho na tela** (não a versão salva) e **uma por vez**. Histórico, logs persistidos e vínculo com `workflow_versions` são da Fase 5. `errorPolicy: "continue"` ainda se comporta como `stop`. *(Atualizado na Fase 5 — ADR 0009: histórico, logs, vínculo com versão e `continue` foram implementados; a execução segue rodando o rascunho, agora guardado como cópia no histórico.)*
9. **Empacotamento:** PyInstaller `onedir` em `resources/engine/`. Evidência em Linux: 35 MB, handshake em 0,05 s, funciona com PATH sem Python, Electron o inicia. **Windows validado pelo Hector:** Python 3.14.8, executável congelado com `pywinauto` 0.6.9 e `pyautogui` 0.9.54 importando, handshake em 0,61 s, 13/13 verificações com PATH sem Python (`docs/engine-packaging.md`).

## Consequências
Falha do motor é um estado do app, não uma exceção: a interface mostra o motivo e a execução é bloqueada com mensagem clara. A superfície IPC cresceu (`engine`, `executions`), com eventos empurrados pelo Main; o teste de segurança do preload fixa a lista exata.
