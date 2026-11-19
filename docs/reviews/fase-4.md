# Revisão — Fase 4 (Biblioteca essencial de ações) — cumulativa: Fases 1, 2, 3 e 4

Verificação executada em Linux: `npm run check` ✅ (lint, typecheck, build, **324 testes Vitest** — 4 execuções seguidas estáveis —, **147 pytest**) e `xvfb-run npm run test:e2e` ✅ (**25 testes** no Electron real, 2 execuções seguidas). Complementa `docs/reviews/fase-4-etapa-1.md`.

## Critérios de aceite da Fase 4

| Critério | Status | Evidência |
|---|---|---|
| Criar uma automação útil de **organização de arquivos** | ✅ Linux / ⚠️ Windows não verificado | Dois níveis: curinga (`*.pdf`) e **"Para cada item"** ("Organizar por tipo": uma pasta por extensão). e2e + integração com arquivos reais no disco, incluindo pasta vazia e **conflito no meio do laço** (para, aponta o nó, não sobrescreve) |
| Abrir um aplicativo e executar uma sequência de teclado/mouse | ⚠️ **Implementado; NÃO verificado no Windows** | Lógica com dublês de `pywinauto`/`pyautogui`; `scripts/verify-actions.py` aguardando o Hector |
| Condições e repetições funcionam | ✅ | Condição, `Repetir` (inclusive aninhado), `Para cada item` (aninhado, mesmo nome, itens simples, lista vazia, 2000 itens), decisão pelo **resultado** de outro nó |
| Ações retornam resultados e erros compreensíveis | ✅ | `outputs` estruturados referenciáveis (`{{nodes.id.resultado}}`), códigos estáveis, mensagens em português apontando nó e causa |

Tarefas do roadmap: 12 de 16 (as 4 de Windows seguem abertas: abrir app, ativar janela, digitar texto, clique e teclas).

## Regressão das Fases 1–3
Todos os testes anteriores passam (e2e das Fases 1–3 inclusos, motor real, cancelamento, queda do motor). Mudanças intencionais em testes antigos: a mensagem de variável inexistente mudou de redação (agora igual nas três formas de referência) e a asserção de segurança do preload lista os grupos novos (`templates`).

## Etapa 2 (esta entrega): o que mudou
Linguagem de expressões ampliada (**ADR 0008**) de `variables.x` para três formas, validada em tempo de desenho; nó `flow.foreach`; resultados declarados no contrato dos nós; seletor "Inserir…"; `files.list` devolve `stem`/`folder`; 2 exemplos novos. O formato do documento **não mudou**.

## Bugs e fragilidades achados nesta etapa
1. **Resultado incompleto parecia completo:** `files.list` trunca em 2000 arquivos e o exemplo "Organizar por tipo" reportava sucesso processando só os 2000 primeiros. Agora a mensagem do nó diz "ATENÇÃO: … os outros N ficaram de fora" e o exemplo avisa.
2. **Validador:** um campo "Lista" apontando para um número (`{{nodes.listar.count}}`) não era recusado. Corrigido com teste.
3. **Teste que não provava a garantia:** trocar `hasOwn` por `in` (permitiria ler propriedades do protótipo) **não quebrava nenhum teste**. Achado por teste de mutação; adicionado teste com valor que só existe no protótipo e confirmado por nova mutação.
4. Testes de mutação (escopo do laço, ordem de execução, isolamento do item): todos pegam a quebra.

## Segurança da linguagem de expressões
Sem `eval`. Lista **fechada** de formas; segmentos só identificadores/posições; `__proto__`/`constructor`/`prototype` recusados na sintaxe; só propriedades próprias; `item.constructor.constructor('return process')()` rejeitado; lista/objeto nunca viram `[object Object]`. Cobertos por testes de ataque e de mutação.

## Desvios dos docs-base / decisões que precisam de aval
1. ⚠️ **ADR 0008 amplia o escopo** (o Hector aprovou "os dois, em etapas"; esta é a segunda etapa): nó `Para cada item`, `{{nodes.id.resultado}}`, `{{item.x}}`, seletor "Inserir…".
2. Substitui a decisão 5 do ADR 0005 (expressões só `variables.x`); nota adicionada ao ADR 0005.

## Débitos técnicos / riscos
- `{{nodes.x}}` dentro de laço devolve a **última** execução do nó (não há histórico por volta).
- Listas só vêm de `files.list` (e truncam em 2000). Sem laço "enquanto", sem matemática/acumuladores.
- Laços longos emitem muitos eventos para a interface (throttling é da Fase 5).
- A ordem de execução do uso de resultados é **aviso**, não erro (um nó pode ter rodado por outro caminho).
- **Windows não verificado:** abrir app, ativar janela, digitar texto (Unicode), atalho, clique, DPI; e o app Electron iniciando o motor com `py -3`.
- Mantidos da Fase 3: heartbeat × ações nativas longas; árvore de processos.

## O que o Hector precisa validar no Windows
1. `python scripts\verify-actions.py` (no venv do motor; `--title "Notepad"` se o Windows for em inglês).
2. No app: Dashboard com motor **Disponível**; "Novo a partir de exemplo" → **Organizar por tipo de arquivo** (aponte `origem` para uma pasta de teste com alguns arquivos e `destino` para uma pasta nova), **Organizar PDFs**, **Bloco de Notas**.
3. No editor: selecionar um nó dentro do laço e usar **"Inserir…"**.

## Atualização — execução real no Windows (Hector, `python scripts\verify-actions.py`)
- ✅ **Arquivos (11/11):** listar com filtro, existência (sim/não), criar pasta, copiar (curinga), conflito sem sobrescrever (`DESTINATION_EXISTS`, nada alterado), mover sobrescrevendo, renomear (nome inválido recusado), caminho relativo recusado, **acentos e espaços**.
- ✅ **Abrir aplicativo** (`notepad.exe`, PID real).
- ⏳ **Janela/teclado/mouse:** falhou com `DEPENDENCY_MISSING` — o Python que rodou o script não importava `pywinauto` (provavelmente o Python do sistema, fora do venv do motor). **Não é falha da lógica**; falta rodar de novo depois de `python -m pip install -r engine\python\requirements-windows.txt`. A mensagem de erro agora informa o import que falhou e o Python em uso, e o script avisa isso no início.
