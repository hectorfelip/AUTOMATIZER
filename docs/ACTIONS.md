# Referência das ações

Todas as ações recebem a config já com `{{variables.x}}` resolvido e devolvem `outputs` estruturados, uma `message` em português e, em falha, um **código estável** + mensagem segura. Caminhos precisam ser **absolutos** (aceitam `~` e variáveis de ambiente como `%USERPROFILE%`). Nenhuma ação apaga arquivos, a não ser substituir um destino quando `overwrite` está ligado.

## Controle (executadas pelo interpretador, não pelo motor)

| Nó | Config | Saídas (portas) | Resultado / erro |
|---|---|---|---|
| `trigger.manual` | — | `next` | Início do fluxo; único por fluxo |
| `flow.end` | `message` | — | Encerra o fluxo como concluído |
| `data.set_variable` | `name` (fixo), `value` | `next` | Converte ao tipo declarado da variável; `INVALID_CONFIG` se não der (ex.: "abc" em número) |
| `flow.condition` | `left`, `operator`, `right` | `true`, `false` | Números comparam como número (`"10" > "9"`); `maior/menor` com texto = `INVALID_CONFIG` |
| `flow.repeat` | `times` (1–100000, aceita `{{nodes.x.count}}`) | `body`, `done` | **Ligue o fim do corpo de volta à entrada do nó.** Sem a volta, o fluxo termina após uma passagem |
| `flow.subflow` | `automationId` (fixo), `arg.<variável>` (um por parâmetro; aceita `{{ }}`) | `success`, `error` | Roda a versão **salva** de outra automação ativa. Resultados: `outputs` (variáveis finais do chamado: `{{nodes.id.outputs.nome}}`), `status`. Erros: `SUBFLOW_NOT_FOUND`/`SUBFLOW_UNAVAILABLE` (inexistente, arquivado, nunca salvo), `SUBFLOW_CYCLE`, `SUBFLOW_DEPTH` (máx. 5), `SUBFLOW_FAILED` (com nome do fluxo e nó) — ADR 0013 |
| `flow.foreach` | `items` (só a referência a uma lista, ex.: `{{nodes.listar.files}}`), `itemName` (fixo, padrão `item`) | `body`, `done` | Percorre a lista, um item por vez; **ligue o fim do corpo de volta à entrada**. Lista vazia vai direto a `done`. Resultados: `index`, `count` |

## Expressões `{{ }}` (ADR 0008)

Só três formas, nada é avaliado (sem `eval`):

| Forma | Exemplo | O que é |
|---|---|---|
| `{{variables.nome}}` | `{{variables.destino}}` | Variável do fluxo |
| `{{nodes.<id>.<resultado>[.caminho]}}` | `{{nodes.listar.count}}`, `{{nodes.listar.files.0.name}}` | Resultado de um nó que já rodou (use "Inserir…" no painel) |
| `{{<item>[.propriedade]}}` | `{{item.path}}`, `{{item.extension}}` | Item atual de um "Para cada item" (só dentro do corpo do laço) |

- Referência "pura" (o campo é só ela) mantém o tipo: `{{nodes.listar.count}}` é número em "Repetir"; em campo de texto vira texto.
- Uma lista inteira só cabe no campo "Lista" do "Para cada item"; em texto use uma posição (`…files.0.name`) ou percorra com o laço. Um objeto inteiro também não cabe: use uma propriedade.
- O validador avisa (antes de executar) nó/resultado/propriedade inexistente e `{{item}}` fora do laço. Usar o resultado de um nó que pode não ter rodado antes é aviso; em execução vira erro claro.
- Caminhos aceitam só nomes e posições (`.0`). `__proto__`, `constructor` e `prototype` são recusados; só propriedades próprias são lidas.

## Resultados por nó (`{{nodes.<id>.<resultado>}}`)

`flow.wait`: `waitedSeconds` · `flow.condition`: `result` · `flow.repeat`: `iteration` · `flow.foreach`: `index`, `count` · `files.list`: `count`, `files`, `folder`, `truncated` · `files.exists`: `exists`, `kind`, `path` · `files.create_folder`: `path`, `created` · `files.copy`/`files.move`: `count`, `overwritten` · `files.rename`: `path`, `oldPath` · `windows.open_app`: `pid`, `application` · `windows.activate_window`: `title`, `handle`, `pid` · `input.type_text`: `length` · `input.click`: `x`, `y`.

## Motor Python

| Ação | Plataforma | Config | `outputs` | Portas | Erros |
|---|---|---|---|---|---|
| `flow.wait` | todas | `seconds` (0–86400) | `waitedSeconds` | `next` | `INVALID_CONFIG` |
| `files.list` | todas | `path`, `pattern` (`*` `?`), `recursive` | `folder, count, files[{name,stem,extension,path,folder,size,modifiedAt}], truncated, skipped` | `success`, `error` | `PATH_NOT_FOUND`, `NOT_A_DIRECTORY`, `PERMISSION_DENIED` |
| `files.exists` | todas | `path` | `path, exists, kind` | `true`, `false` | `INVALID_CONFIG` |
| `files.create_folder` | todas | `path` | `path, created` | `success`, `error` | `DESTINATION_EXISTS` (já há um *arquivo* com o nome), `PERMISSION_DENIED` |
| `files.copy` / `files.move` | todas | `source` (aceita `*`/`?` **só no nome**), `destination`, `overwrite` | `count, items[{source,destination}], overwritten, truncated` | `success`, `error` | `PATH_NOT_FOUND`, `IS_A_DIRECTORY`, `NOT_A_DIRECTORY`, `SAME_PATH`, `DESTINATION_EXISTS`, `PERMISSION_DENIED`, `IO_ERROR` |
| `files.rename` | todas | `path`, `newName` (só o nome) | `oldPath, path` | `success`, `error` | `INVALID_CONFIG`, `PATH_NOT_FOUND`, `SAME_PATH`, `DESTINATION_EXISTS` |
| `windows.open_app` | todas* | `application`, `arguments` | `pid, application` | `success`, `error` | `APP_NOT_FOUND`, `APP_START_FAILED` (inclui "exige administrador") |
| `windows.click_element` | `windowTitle`, `elementName` (contém, sem caixa/acentos) e/ou `automationId` (exato), `controlType` (opcional), `index` (1+), `button`, `timeoutSeconds` | `success`, `error` | **UI Automation** (pywinauto): acha o elemento VISÍVEL por nome/id/tipo, espera ele aparecer e clica no centro com `pyautogui` (mantém a parada de emergência). Resultados `x`, `y`, `name`, `controlType`. Erros: `WINDOW_NOT_FOUND`, `ELEMENT_NOT_FOUND`, `FAILSAFE_TRIGGERED`, `COORDINATES_OUT_OF_SCREEN`, `DEPENDENCY_MISSING`, `UNSUPPORTED_PLATFORM`. Preferível a `input.click` (não depende de resolução/escala) |
| `windows.activate_window` | Windows | `title` (trecho, sem diferenciar maiúsculas), `timeoutSeconds` | `title, handle, pid` | `success`, `error` | `WINDOW_NOT_FOUND`, `WINDOW_ACTIVATION_FAILED`, `UNSUPPORTED_PLATFORM`, `DEPENDENCY_MISSING` |
| `input.type_text` | Windows | `text` (máx. 5000) | `length` | `success`, `error` | `INVALID_CONFIG`, `UNSUPPORTED_PLATFORM`, `DEPENDENCY_MISSING` |
| `input.hotkey` | Windows | `keys` (`ctrl+s`, `alt+f4`, `win+r`…) | `keys` | `success`, `error` | `INVALID_CONFIG`, `FAILSAFE_TRIGGERED` |
| `input.click` | Windows | `x`, `y`, `button` (esquerdo/direito/duplo) | `x, y, button` | `success`, `error` | `INVALID_CONFIG`, `COORDINATES_OUT_OF_SCREEN`, `FAILSAFE_TRIGGERED` |

\* `open_app` usa `Popen` sem shell, destacado do motor (o aplicativo sobrevive a um reinício do motor).

## Regras que valem para todas
- **Conflitos são checados antes** de qualquer alteração (copiar/mover em lote é tudo-ou-nada no pré-check). Falha *durante* o lote informa quantos arquivos já tinham sido processados.
- **Curinga sem correspondência não é erro:** `count: 0` e a mensagem diz que nada foi feito.
- **Parada de emergência:** `pyautogui.FAILSAFE` ligado; levar o mouse ao canto da tela interrompe cliques e atalhos (`FAILSAFE_TRIGGERED`).
- **Limites:** listas são truncadas (`truncated: true`) para caber no limite de 1 MiB por mensagem do protocolo.
- Teclado e mouse agem **na janela em foco**: use "Ativar janela" antes de "Digitar texto". Aplicativos executados como administrador exigem que o Automation Studio também rode como administrador.

## Navegador (Playwright — ADR 0012)

Requer `playwright` (`engine/python/requirements-web.txt`) e um navegador (Edge/Chrome no Windows). Uma sessão por execução: abre em `web.navigate`, fecha em `web.close`, ao fim da execução ou após 10 min parada. Só `http://`/`https://`. Seletores: CSS, `text=…`, `role=button[name='…']`, `xpath=…`. Todos têm "Esperar até (s)" e aceitam `{{ }}`.

| Nó | Config | Resultados | Erros principais |
|---|---|---|---|
| `web.navigate` | `url`, `timeoutSeconds` (1–120, padrão 30), `showBrowser` | `url`, `title`, `status` | `INVALID_CONFIG` (esquema), `NAVIGATION_TIMEOUT`, `NAVIGATION_FAILED`, `HTTP_ERROR` (≥400), `BROWSER_UNAVAILABLE`, `DEPENDENCY_MISSING` |
| `web.click` | `selector`, `timeoutSeconds` | `selector` | `NO_BROWSER`, `ELEMENT_NOT_FOUND` |
| `web.fill` | `selector`, `text` (vazio limpa), `timeoutSeconds` | `selector`, `length` | idem; a mensagem **não repete o texto** |
| `web.extract` | `selector`, `attribute` (vazio = texto; `value` = valor atual do campo), `timeoutSeconds` | `text` (primeiro), `items` (até 200), `count` | `ELEMENT_NOT_FOUND` |
| `web.wait` | `selector`, `state` (`visible`/`hidden`/`attached`/`detached`), `timeoutSeconds` | `selector`, `state` | `ELEMENT_NOT_FOUND` |
| `web.close` | — | `closed` | — |

Cancelar interrompe esperas/cliques em < 1 s; cancelar durante o carregamento de uma página vale quando ela terminar ou estourar o prazo.

## Visão / OCR (ADR 0015)

Só **Windows** (Windows.Media.Ocr; idioma do perfil do usuário, ex.: pt-BR). Requer `engine/python/requirements-vision.txt` (`pyautogui`, `pillow`, `winrt-*`). Preferência de automação: UIA > janela > navegador > **OCR** > coordenadas.

| Nó | Config | Resultados | Erros principais |
|---|---|---|---|
| `vision.find_text` | `text` (ignora caixa e acentos), `similarity` (0,3–1; padrão 0,8), `timeoutSeconds`, região `regionX/Y/Width/Height` (todos 0 = tela inteira) | `centerX`, `centerY`, `x`, `y`, `width`, `height`, `matchedText`, `similarity`, `attempts` | `TEXT_NOT_FOUND_ON_SCREEN` (diz a melhor similaridade; **não repete o que foi lido na tela**), `UNSUPPORTED_PLATFORM`, `DEPENDENCY_MISSING` (diz qual import e qual Python), `OCR_LANGUAGE_MISSING`, `INVALID_CONFIG` |

O OCR não dá confiança por palavra: o **limiar é a similaridade** entre o procurado e o lido (tolera ruído, ex.: "Prompt para" lido como "Promptpa" = 0,84). Espera o texto aparecer (consulta a cada 0,5 s; cancelamento em < 1 s). Use o resultado em "Clique": `{{nodes.<id>.centerX}}` / `{{nodes.<id>.centerY}}`. Coordenadas e captura usam o mesmo espaço de pixels do `pyautogui` (escalas de DPI não foram validadas). **Localizar imagem não existe ainda.**
