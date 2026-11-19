# ADR 0011 — Agendamento com o Agendador de Tarefas do Windows (Fase 6b)

**Status:** proposta — aguardando aval do Hector. ⚠️ `ARCHITECTURE.md §15` mantém a "estratégia final de agendamento" aberta até haver protótipo em Windows real; esta implementação segue o que o `PROJECT_SPEC §4.8` já nomeia (Agendador de Tarefas), mas **nada do lado Windows foi executado**.

## Decisões
1. **Quem dispara é o Windows, não o app.** O app não mantém timers próprios (não depende de estar aberto). Cada agendamento vira uma tarefa `AutomationStudio\<id-do-agendamento>` criada com `schtasks /Create /XML`, que chama o próprio executável com `--run-automation=<id> --schedule=<id>`. O banco guarda o que o usuário **quer**; a coluna `task_state` (`synced`/`error`/`unsupported`) diz se o Windows já sabe — falha ao registrar nunca perde o agendamento (aparece o motivo e "Tentar registrar de novo").
2. **Tipos:** única (data/hora), diária, semanal (dias) e "ao entrar no Windows" (opcional no spec). Horários são locais do computador.
3. **Sessão e computador desligado (roadmap):** tarefa com `LogonType=InteractiveToken` + `RunLevel=LeastPrivilege` → roda **na sessão do usuário, sem elevar**; automação de mouse/teclado só funciona com a sessão conectada e desbloqueada (a tela diz isso, sem prometer o contrário). `StartWhenAvailable=true` → se o computador estava desligado na hora, roda ao ligar. `MultipleInstancesPolicy=IgnoreNew` e o app também recusa execução simultânea (registra `skipped_busy`).
4. **O que roda:** a **versão salva** (nunca o rascunho do editor). Fluxos com erros de validação, automação arquivada/excluída, agendamento desativado, motor indisponível ou fluxo nunca salvo **não executam** e o motivo fica em "Última execução". A execução entra no histórico com modo `scheduled` e o log "Execução iniciada pelo agendamento."
5. **Ciclo do processo:** se o app foi aberto pelo Agendador, fecha sozinho ao terminar (depois de o histórico gravar o fim — `shutdown` agora espera esse registro). Se já estava aberto, a instância em execução recebe o pedido (`second-instance`) e roda sem roubar o foco.
6. **Segurança:** os argumentos aceitos são `--run-automation=<id>` e `--schedule=<id>` com ids `[A-Za-z0-9_-]{1,100}`; qualquer outro formato é ignorado inteiro (nunca executa "meio certo"). O XML da tarefa é gerado por nós com valores escapados e **nome/argumentos validados contra lista segura**; `schtasks` roda por `execFile` **sem shell**, com argumentos separados. O renderer só envia `{automationId, config}` (zod `strictObject`; campo extra como `command` é recusado) — nunca caminhos nem comandos.
7. ⚠️ **Banco:** migração `0004` cria `schedules` com as colunas do `ARCHITECTURE.md §9` **mais** `last_status`, `task_state`, `task_error` e carimbos. Excluir a automação remove as tarefas do Windows (antes) e as linhas (cascata).
8. ⚠️ **Só registra no Windows com o app instalado** (`app.isPackaged`): em desenvolvimento o executável seria o do Electron, sem o app. Fora disso o agendamento fica salvo como "não registrado" e a tela avisa.
9. **IPC novo:** `schedules:list|create|update|set-enabled|resync|remove`. `ErrorCode IO_ERROR` (da ADR 0010) também cobre falha ao remover a tarefa. `automations:delete` passou a ser assíncrono (remove tarefas antes).

## Não verificado em Windows (precisa de você)
Criação/remoção real da tarefa (`schtasks`), aceitação do XML (UTF-16 LE com BOM, esquema 1.2), disparo na hora marcada, `StartWhenAvailable` com o PC desligado, `LogonTrigger`, comportamento com sessão bloqueada, e o app instalado chamando o próprio executável com os argumentos.

## Fora do escopo
Intervalos ("a cada N minutos"), exceções/feriados, executar com usuário desconectado (inviável para automação de tela), notificações ao fim.
