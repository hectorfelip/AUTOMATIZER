# ADR 0007 — Biblioteca de ações (Fase 4, etapa 1)

**Status:** proposta — aguardando validação no Windows e aval do Hector (itens ⚠️ são decisões de UX/escopo)

## Contexto
O roadmap pede, nesta fase, "uma automação útil de organização de arquivos". A lista de ações não tem como repetir uma ação **para cada** arquivo listado. O Hector escolheu **os dois, em etapas**: etapa 1 = a lista do roadmap com curingas em copiar/mover/renomear; etapa 2 (após validar a 1 no Windows) = "Para cada item" + resultado dos nós nas expressões, com ADR próprio.

## Decisões
1. **Condição, repetição e variável** são executadas pelo **interpretador** (Node), não pelo motor. ⚠️ **"Repetir" exige ligar o fim do corpo de volta à entrada do nó** (o validador já tratava ciclos por nós de decisão como legítimos). Alternativa descartada: laço "estruturado" com bloco — exigiria mudar o editor e o formato do documento.
2. **Comparação:** se os dois lados são números, compara como número (`"10" > "9"`); senão como texto. `maior/menor` com texto é **erro**, nunca ordem alfabética silenciosa.
3. **Variáveis com tipo:** `set_variable` converte ao tipo declarado ("5" → 5) e falha se não der. Referência "pura" (`{{variables.n}}`) preserva o tipo; o resultado é ajustado ao tipo do **campo de destino** (texto vira texto, número aceita "5"). Campo marcado `literal` (nome da variável) recusa `{{…}}` — antes o validador pulava a checagem de padrão em campos com template.
4. **Arquivos:** só arquivos (não pastas) em copiar/mover/renomear; **caminhos absolutos** com `~`/variáveis de ambiente; curinga `*`/`?` **só no nome**; conflitos checados **antes** de tocar em qualquer arquivo; `overwrite` desligado por padrão e, ⚠️ **ligar exige confirmação na interface**. ⚠️ **Não há ação "Excluir arquivo"** nesta fase (consta no SPEC §4.4, não no roadmap da Fase 4): decisão consciente, por segurança.
5. **Janelas/teclado/mouse (Windows):** localizar/ativar janela por **UI Automation** (`pywinauto`, backend `uia`); **digitar texto** por `pywinauto.keyboard.send_keys` (Unicode, com escape de `+ ^ % ~ ( ) { }`); **atalho e clique** por `pyautogui` com **failsafe ligado**. `open_app` usa `Popen` **sem shell** e destacado do motor.
6. **Limite de passos** do interpretador subiu de 10 000 para 1 000 000 (o laço aceita 100 000 voltas; o timeout global é a outra rede de segurança).
7. **Exemplos prontos** em `/templates` (4: organizar PDFs, backup condicional, repetir, Bloco de Notas), instanciados pelo canal IPC `templates` como automação nova com o fluxo salvo como versão 1. Os exemplos são validados e **executados pelo pipeline real** nos testes.
8. **Referência das ações** em `docs/ACTIONS.md`.

## O que NÃO está verificado
Tudo que depende de Windows: `open_app` com `notepad.exe`, `activate_window`, `type_text` com Unicode, `hotkey`, `click`, DPI. Cobertos por testes com dublês de `pywinauto`/`pyautogui` (lógica real, efeito simulado) e pelo `scripts/verify-actions.py`, que o Hector roda no Windows.

## Consequências
Um fluxo de "organizar por tipo" ainda não é expressável (precisa da etapa 2). Resultados dos nós já saem estruturados (`outputs`), mas ainda não são referenciáveis por outros nós.
