# Revisão — Fase 5 (Execução, depuração e histórico) — cumulativa: Fases 1, 2, 3, 4 e 5

Verificação executada em Linux: `npm run check` ✅ (lint, typecheck, build, **397 testes Vitest**, **147 pytest**) e `xvfb-run npx playwright test` ✅ (**35 testes** no Electron real, **2 execuções seguidas** sem falha nem flaky). Decisões em **ADR 0009** (proposta, aguardando seu aval).

## Critérios de aceite da Fase 5

| Critério | Status | Evidência |
|---|---|---|
| Usuário identifica qual nó está executando | ✅ | Painel ("Nó atual: …"), cartão do nó no canvas ("Executando", "Pausado aqui", "Concluído", "Falhou"), e2e `passo a passo` / `pausar` |
| Falhas apontam o nó e a causa | ✅ | `failedNodeId` no evento final; painel e histórico mostram "Nó que falhou: Mover arquivo" + causa; e2e `política 'parar'` e `histórico` |
| Histórico continua disponível após reiniciar | ✅ | e2e fecha e **reabre o app** e lista/filtra/abre detalhes; queda abrupta (SIGKILL) vira "Falhou — O aplicativo foi fechado durante a execução." |
| Cancelamento não deixa o motor inconsistente | ✅ | Cancelar também com execução **pausada**; e2e das fases 3/5 (cancelar e rodar de novo); `shutdown()` agora espera o fim gravar antes de fechar o banco |

Tarefas do roadmap: 13 de 13 da Fase 5 (captura real de tela marcada **não verificada no Windows**). Das Fases 1–4 seguem abertas as 4 de Windows (abrir app, ativar janela, digitar texto, clique/teclas).

## O que foi entregue
Painel de execução com nó atual, estado por nó e **variáveis/resultados** (visualizador); **Executar / Passo a passo / Pausar / Continuar / Próximo passo / Cancelar**; **Executar a partir daqui** (com valores iniciais de variáveis); **breakpoints** (botão ● no nó e F9; persistem localmente); política de erro e tempo limite editáveis (painel Variáveis) com status novo `completed_with_warnings`; **histórico** (lista, filtros por automação/resultado/período, estatísticas, detalhes com log filtrável por nível, contexto final, limpar com confirmação) e Dashboard com execuções recentes; **diagnóstico opcional** (Configurações).

## Regressão das Fases 1–4
Todos os testes anteriores passam. Mudanças intencionais em testes antigos: botões "Executar" nos e2e agora usam nome exato (surgiu "Executar a partir daqui"); o teste que fixa a API do preload lista `history` e os novos métodos de `executions`; `start` recebe `automationId`; `AppSettings` ganhou `captureDiagnostics`.

## Bugs e fragilidades achados (e corrigidos) nesta fase
1. **Recursão infinita** que eu mesmo introduzi num refactor (`release` chamando `release`) — pega pelos testes do gerenciador.
2. **Histórico mostrava o tipo técnico** (`files.move`) no lugar do nome do nó — corrigido para "Mover arquivo".
3. **Teste sem dentes:** removi `history.recoverInterrupted()` do início do app (mutação) → o e2e de queda **falhou** como deveria ("Em execução" para sempre). Restaurado. Mutações no interpretador (timeout pausável, `isContinuable`, re-pausa do passo) também são pegas pelos testes.
4. Fechar o app não esperava o fim da execução gravar → corrida com `db.close()`; `shutdown()` agora devolve promessa (até 5 s).
5. Excluir uma automação deixaria capturas de tela órfãs; os caminhos agora são coletados **antes** da exclusão e os arquivos apagados depois.
6. Laço longo × histórico: teste com 500 voltas e teto de log pequeno confirma que o teto vale, o excedente vira linha "eventos omitidos" e a execução termina normalmente.

## Segurança (revisão)
- Novos canais IPC: todos com zod `strictObject`, limites (página ≤200, datas válidas, listas ≤2000) e checagem de origem; testes de entrada inválida e de "todos os canais recusam origem não confiável" cobrem os novos.
- Captura de tela: **opt-in**, local, apagada com o histórico; o renderer não lê arquivos — só `history:diagnostic` (execução + seq) → data URL; a leitura recusa caminhos fora da pasta de diagnósticos (teste).
- Sem `eval`, sem shell, protocolo Node↔Python **inalterado**. O contexto mostrado ao usuário é uma prévia limitada (nunca o objeto bruto).
- **Atenção a segredos:** valores de variáveis e resultados de nós vão para o histórico (`snapshot_json`/logs). Se o usuário colocar uma senha numa variável, ela fica no histórico local. Mitigação futura: tipo "segredo" que nunca entra em snapshot/log.

## Desvios dos docs-base / decisões que precisam de aval (ADR 0009)
1. ⚠️ Colunas/tabelas além do que `ARCHITECTURE.md §9` lista (cópia do fluxo executado, modo, avisos, nó do erro, `seq`, caminho da captura). `ARCHITECTURE.md` já foi atualizado.
2. ⚠️ Status novo `completed_with_warnings` e semântica da política `continue` (lista de erros que nunca continuam).
3. ⚠️ `executions:start` mudou de contrato (`automationId` + `options`).
4. ⚠️ Captura de tela via `desktopCapturer` do Electron (opt-in).
5. Breakpoints locais (não vão para versões nem exportação).

## Débitos técnicos / riscos
- **Sem throttling de eventos** de IPC em laços muito longos (o painel guarda uma linha por nó e o histórico é limitado a 5000 linhas, mas o IPC emite tudo).
- Pausa **só entre nós**; uma ação longa (espera de 60 s) não pausa no meio (documentado no painel).
- `{{nodes.x}}` num laço continua devolvendo a última execução do nó (débito da Fase 4).
- "A partir daqui" não simula o contexto dos nós anteriores; avisa quando o fluxo usa `{{nodes.…}}`.
- Histórico com "Mostrar mais" (sem rolagem infinita); sem exportação de logs.
- **Windows não verificado:** tudo o que já estava pendente (ações de janela/teclado/mouse, DPI, instalador, agendador) **mais** a captura real de tela com `desktopCapturer` (aqui só rodou sob xvfb, onde a captura pode vir vazia — o teste é tolerante a isso de propósito) e o fechamento do app com execução em andamento.

## O que o Hector precisa validar no Windows
1. `python scripts\verify-actions.py` (ainda pendente da Fase 4).
2. No app: abrir um exemplo → **Passo a passo** (veja o nó atual e o painel de variáveis) → **Pausar** durante uma espera → **Continuar**; ligar um breakpoint (●) e executar; selecionar um nó e **Executar a partir daqui**.
3. Provocar uma falha (ex.: "Mover arquivo" com conflito) e conferir em **Histórico** o nó e a causa; **fechar e reabrir o app** e ver o histórico.
4. Em Configurações, ligar **Capturar a tela quando um nó falhar**, repetir a falha e abrir "Ver captura da tela" no detalhe. Se a imagem vier preta/vazia no seu Windows, me avise (é o ponto mais incerto desta fase).
5. Com a execução rodando, fechar a janela: o app deve fechar sem travar e a execução constar como cancelada/interrompida no histórico.
