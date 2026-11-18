# Revisão — Fase 3 (Protocolo e motor mínimo) — cumulativa: Fases 0, 1, 2 e 3

Verificação executada: `npm run check` ✅ (lint, typecheck, build, **202 testes Vitest**, **26 pytest**) e `xvfb-run npm run test:e2e` ✅ (**18 testes** no Electron real). Capturas de tela revisadas.

## Critérios de aceite da Fase 3

| Critério | Status | Evidência |
|---|---|---|
| App inicia o motor e identifica sua disponibilidade | ✅ Linux / ⚠️ Windows não verificado | e2e: Dashboard mostra "Disponível · Motor 0.1.0 · Python 3.x"; sem motor, "Indisponível" + motivo |
| Fluxo mínimo é enviado e executado | ✅ | e2e: Início → Esperar → Fim concluído; 18 testes do interpretador |
| Eventos aparecem na interface | ✅ | e2e: aba "Execução" com estado por nó, barra de progresso e resultado final |
| Falha do motor não encerra o app | ✅ | e2e: `SIGKILL` no motor durante a execução → "Execução falhou", app de pé, motor reinicia e roda de novo; motor ausente → app abre normalmente |
| Logs de protocolo não se misturam com stdout de diagnóstico | ✅ | pytest (com **teste de mutação**: sem o redirecionamento o teste falha) + integração Node |
| Motor empacotado responde sem Python global (Windows) | ✅ **Linux e Windows** | Windows (Hector): Python 3.14.8, `pywinauto` 0.6.9 e `pyautogui` 0.9.54 importam no executável congelado, handshake 0,61 s, 13/13 com PATH sem Python. Linux: idem + Electron inicia o executável (e2e) |

Tarefas do roadmap: 12/12.

## Regressão das Fases 0–2
Os 11 e2e anteriores passam. Dois ajustes **intencionais**: o card do motor no Dashboard agora é dinâmico (antes o teste esperava "Indisponível" fixo) e a asserção de segurança do preload lista os grupos novos (`engine`, `executions`), continuando a ser trava. `AppInfo` perdeu o campo `engineStatus` (substituído pelo canal `engine:status`).

## Bugs encontrados e corrigidos nesta fase
1. **Motor não iniciava quando o app era aberto pelo e2e**: eu derivava a raiz do repositório de `app.getAppPath()`, que muda conforme o modo de início. Além disso o Node devolve `ENOENT` para *pasta inexistente* igual a *comando inexistente*, e a mensagem "python3 não encontrado" era enganosa. Corrigido: raiz relativa ao bundle (`__dirname`) e mensagem que distingue pasta de comando (com teste).
2. **Resolução de variáveis com tipo errado** (achado por teste): `{{variables.n}}` num campo de *texto* chegava ao motor como número. Agora o valor é ajustado ao tipo do campo de destino.
3. Testes meus com corrida: o stderr do motor chega por outro pipe e pode vir depois da resposta da ação; o teste esperava ordem.
4. Erro de tipagem no store do motor (`set` devolvendo o status em vez de um patch).

## Desvios dos docs-base / decisões que precisam de aprovação (ADR 0006)
1. ⚠️ `flow.wait` implementado já na Fase 3 (consta na Fase 4).
2. ⚠️ `execution-manager` vive no Main, não como pacote (`ARCHITECTURE.md §4`).
3. ⚠️ Ações de teste no motor atrás de `AUTOMATION_ENGINE_TEST_ACTIONS=1`.
4. Execução roda o rascunho da tela, uma por vez; histórico/versão vinculada ficam para a Fase 5.

## Débitos técnicos / riscos
- **Heartbeat × ações nativas**: uma chamada nativa que segure o GIL por >15 s derrubaria um motor saudável. Hoje só existe `flow.wait`; reavaliar na Fase 4 (pyautogui/pywinauto).
- **Árvore de processos**: se ações da Fase 4 abrirem aplicativos como filhos do motor, matar o motor pode deixá-los órfãos ou fechá-los. Decidir na Fase 4.
- Mensagens do motor limitadas a 1 MiB (ex.: listar pasta enorme): ações devem paginar ou truncar.
- Logs do motor só vão ao console do Main (persistência é da Fase 5); o nó em execução não é destacado no canvas (Fase 5).
- A ação em voo **não é refeita** após queda do motor (decisão deliberada: pode ter efeito colateral).
- Antivírus pode sinalizar o executável PyInstaller (mitigar com assinatura na Fase 9).

## Não verificável aqui (precisa do Hector no Windows)
✅ Spike validado pelo Hector (ver tabela). **Ainda não exercitado no Windows:** o app Electron iniciando o motor (modo dev com `py -3`, e/ou `AUTOMATION_STUDIO_ENGINE`) e executar um fluxo por lá (Dashboard "Disponível" + Executar).

## Decisões do Hector
ADR 0006 aprovado integralmente.
