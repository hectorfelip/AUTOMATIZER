# Revisão — Fase 6b (Agendamento) — cumulativa: Fases 1–5, 6a e 6b

Verificação em Linux: `npm run check` e e2e completo (ver commit). ADR 0011.

| Critério | Status | Evidência |
|---|---|---|
| Agendamentos visíveis, editáveis e que podem ser desativados | ✅ Linux | e2e: criar, desativar (próxima vira "—"), editar (diária→semanal), reativar, excluir com confirmação |
| Integrar com o Agendador de Tarefas do Windows | ⚠️ **implementado; NÃO verificado no Windows** | XML e `schtasks` testados com dublê (29 testes); nenhuma tarefa real foi criada |
| Próxima e última execução | ✅ | cálculo puro testado (único/diário/semanal, virada de mês/ano); `recordRun` e e2e com disparo real por linha de comando |
| Computador desligado / usuário desconectado | ⚠️ configurado (`StartWhenAvailable`, `InteractiveToken`), não verificado | documentado no guia e no diálogo |
| Documentar limitações de sessão interativa | ✅ | USER_GUIDE §6, diálogo e tela de agendamentos |

## O que foi exercitado de verdade (Electron real, Linux)
O caminho que o Agendador usa: abrir o app com `--run-automation=<id> --schedule=<id>` → roda a versão salva → grava no histórico (modo "Agendada") e no agendamento → **o app fecha sozinho**. Também: agendamento desativado não executa e registra `skipped_disabled`; argumentos malformados não executam nada.

## Achados
1. `shutdown()` não esperava o registro do fim (capturas/histórico) nem o aviso `onFinished` → sem isso o app agendado poderia fechar o banco antes de gravar. Corrigido (`finalizing`) com teste.
2. `automations:delete` precisava remover as tarefas do Windows **antes** de o banco apagar as linhas; agora é assíncrono (regressão tratada nos testes do IPC).
3. Mutação: remover `recordRun` do fim da execução quebra o e2e do disparo.

## Segurança
Argumentos de linha de comando em lista estrita (testes com `;`, `&`, `../`, espaços, ids longos); XML com valores escapados e nome/args validados; `schtasks` via `execFile` sem shell; renderer não envia comandos nem caminhos (`strictObject`, testado).

## Débitos / riscos
- **Tudo do lado Windows** (criar/remover tarefa, XML aceito, disparo, PC desligado, sessão bloqueada, app instalado chamando a si mesmo).
- Escalas de horário de verão/fuso: horários são "relógio local"; `nextRun` usa o fuso do SO (testado sem cenário de DST).
- Sem "a cada N minutos", sem notificação ao terminar.
- A janela do app abre no disparo agendado (não há modo "sem janela").

## O que o Hector precisa validar no Windows (app instalado)
1. Criar um agendamento "uma vez" para daqui a 2 minutos e conferir no **Agendador de Tarefas** do Windows a pasta `AutomationStudio` e a tarefa; ver se roda e se o histórico mostra "Agendada".
2. Desativar no app e conferir que a tarefa ficou desabilitada; excluir e conferir que sumiu.
3. Agendar, desligar/bloquear a sessão e ver o que acontece (`StartWhenAvailable`; ações de teclado com tela bloqueada devem falhar com mensagem clara).
4. Se "Erro no Windows" aparecer, copie a mensagem exibida.
