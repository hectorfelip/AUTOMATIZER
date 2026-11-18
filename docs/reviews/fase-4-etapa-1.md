# Revisão intermediária — Fase 4, etapa 1 (biblioteca de ações)

> Relatório **parcial**. A revisão cumulativa (Fases 1–4) acontece no fim da Fase 4, depois da etapa 2 ("Para cada item" + resultado dos nós). Verificação: `npm run check` ✅ (**251 Vitest**, **146 pytest**) e `xvfb-run npm run test:e2e` ✅ (**23 testes**, 2 execuções seguidas), tudo em Linux.

## Critérios de aceite da Fase 4

| Critério | Status | Evidência |
|---|---|---|
| Criar uma automação útil de **organização de arquivos** | ✅ Linux / ⚠️ Windows não verificado | e2e e integração: move só os PDFs para uma pasta criada na hora, no disco real; conflito não sobrescreve e não altera nada. **Limite:** processa "todos os que casam com `*.pdf`"; tratar cada arquivo de forma diferente é a etapa 2 |
| Abrir um aplicativo e executar uma sequência de teclado/mouse | ⚠️ **Implementado; não verificado no Windows** | Lógica testada com dublês de `pywinauto`/`pyautogui`. `scripts/verify-actions.py` para o Hector rodar |
| Condições e repetições funcionam | ✅ | 28 testes do interpretador + e2e (decisão por existência de pasta, variável, `contém`, repetição 3×, laço aninhado 2×3) |
| Ações retornam resultados e erros compreensíveis | ✅ | `outputs` estruturados + códigos estáveis (`docs/ACTIONS.md`); mensagens em português apontando nó e causa |

Tarefas do roadmap: 11 de 15 marcadas. As 4 pendentes (abrir aplicativo, ativar janela, digitar texto, clique e teclas) só fecham no Windows.

## Bug sério encontrado (existia desde a Fase 3)
**O motor avisava "ação concluída" antes de liberar a execução.** O interpretador responde na hora com o próximo nó da mesma execução e recebia `BUSY`. Em fluxos reais com nós em sequência isso falharia de forma **intermitente**. Os e2e da Fase 3 passavam por sorte de timing; só a carga do Vitest em paralelo expôs. Reproduzi de forma determinística (cliente que responde dentro do envio do evento), corrigi (liberar o token *antes* de enviar a mensagem terminal, só se ainda for o próprio) e deixei teste de regressão. Estável em 10 execuções seguidas.

## Outros bugs achados por testes
1. `files.rename`: eu fazia `strip()` antes de validar, então "nome " virava "nome" e a regra do Windows nunca disparava (renomearia para um nome diferente do pedido).
2. `files.copy/move`: `C:\x\*\a.txt` (curinga em pasta) dava "não encontrei" em vez de explicar a regra.
3. Validador: campo com `{{…}}` pulava a checagem de padrão, então um nome de variável "dinâmico" passava. Criei o marcador `literal`.
4. Resolução de variáveis: ajustada ao tipo do campo (feito na Fase 3; reforçado com `set_variable`).

## Decisões que precisam de aval (ADR 0007)
1. ⚠️ **"Repetir" exige ligar o fim do corpo de volta à entrada** do nó. Sem a volta, o fluxo termina após uma passagem. É consequência do desenho do grafo; a alternativa (bloco/laço estruturado) mudaria o editor e o formato do documento.
2. ⚠️ **Não há ação "Excluir arquivo"** (consta no SPEC §4.4, não no roadmap da Fase 4). Decisão de segurança: a única forma de destruir dados é `overwrite`, que é desligado por padrão e **exige confirmação na interface**.
3. `maior/menor que` com texto é **erro** (nunca ordem alfabética silenciosa).
4. Limite de passos do interpretador: 10 000 → 1 000 000.

## Débitos técnicos / riscos
- **Muitos eventos em laços grandes**: um "Repetir 100000" emite eventos por nó/volta para a interface. Throttling é assunto da Fase 5.
- Itens de lista truncados em 2000 (`truncated: true`) por causa do limite de 1 MiB por mensagem.
- `type_text` por `send_keys` com Unicode: **comportamento com acentos/símbolos só se confirma no Windows**.
- DPI/escala: `pyautogui` declara DPI awareness ao importar, mas as coordenadas de `click` seguem frágeis entre monitores/escalas.
- Aplicativos como administrador: ativar janela/teclar pode falhar sem o Automation Studio também elevado (mensagem de erro já orienta).
- Windows não exercitado: Electron iniciando o motor (modo dev com `py -3`, ou `AUTOMATION_STUDIO_ENGINE`).

## O que o Hector precisa validar no Windows
1. `python scripts\verify-actions.py` (no venv do motor): arquivos (automático) + Bloco de Notas com confirmação visual do texto digitado. Use `--title "Notepad"` se o Windows estiver em inglês.
2. No app (`npm run dev -w @automation-studio/desktop`): Dashboard mostra o motor **Disponível**; "Novo a partir de exemplo" → **Organizar PDFs** (edite as variáveis `origem`/`destino`), **Backup condicional** e **Bloco de Notas**.
