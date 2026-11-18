# Referência das ações

Todas as ações recebem a config já com `{{variables.x}}` resolvido e devolvem `outputs` estruturados, uma `message` em português e, em falha, um **código estável** + mensagem segura. Caminhos precisam ser **absolutos** (aceitam `~` e variáveis de ambiente como `%USERPROFILE%`). Nenhuma ação apaga arquivos, a não ser substituir um destino quando `overwrite` está ligado.

## Controle (executadas pelo interpretador, não pelo motor)

| Nó | Config | Saídas (portas) | Resultado / erro |
|---|---|---|---|
| `trigger.manual` | — | `next` | Início do fluxo; único por fluxo |
| `flow.end` | `message` | — | Encerra o fluxo como concluído |
| `data.set_variable` | `name` (fixo), `value` | `next` | Converte ao tipo declarado da variável; `INVALID_CONFIG` se não der (ex.: "abc" em número) |
| `flow.condition` | `left`, `operator`, `right` | `true`, `false` | Números comparam como número (`"10" > "9"`); `maior/menor` com texto = `INVALID_CONFIG` |
| `flow.repeat` | `times` (1–100000) | `body`, `done` | **Ligue o fim do corpo de volta à entrada do nó.** Sem a volta, o fluxo termina após uma passagem |

## Motor Python

| Ação | Plataforma | Config | `outputs` | Portas | Erros |
|---|---|---|---|---|---|
| `flow.wait` | todas | `seconds` (0–86400) | `waitedSeconds` | `next` | `INVALID_CONFIG` |
| `files.list` | todas | `path`, `pattern` (`*` `?`), `recursive` | `folder, count, files[{name,path,extension,size,modifiedAt}], truncated, skipped` | `success`, `error` | `PATH_NOT_FOUND`, `NOT_A_DIRECTORY`, `PERMISSION_DENIED` |
| `files.exists` | todas | `path` | `path, exists, kind` | `true`, `false` | `INVALID_CONFIG` |
| `files.create_folder` | todas | `path` | `path, created` | `success`, `error` | `DESTINATION_EXISTS` (já há um *arquivo* com o nome), `PERMISSION_DENIED` |
| `files.copy` / `files.move` | todas | `source` (aceita `*`/`?` **só no nome**), `destination`, `overwrite` | `count, items[{source,destination}], overwritten, truncated` | `success`, `error` | `PATH_NOT_FOUND`, `IS_A_DIRECTORY`, `NOT_A_DIRECTORY`, `SAME_PATH`, `DESTINATION_EXISTS`, `PERMISSION_DENIED`, `IO_ERROR` |
| `files.rename` | todas | `path`, `newName` (só o nome) | `oldPath, path` | `success`, `error` | `INVALID_CONFIG`, `PATH_NOT_FOUND`, `SAME_PATH`, `DESTINATION_EXISTS` |
| `windows.open_app` | todas* | `application`, `arguments` | `pid, application` | `success`, `error` | `APP_NOT_FOUND`, `APP_START_FAILED` (inclui "exige administrador") |
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
