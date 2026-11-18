# Protocolo Node ↔ Motor Python (v1)

Detalha `ARCHITECTURE.md §8`. Processo Python filho do Electron Main, comunicação **JSON Lines** por stdin/stdout.

## Regras de transporte
- Uma mensagem = um objeto JSON em UTF-8 em **uma linha** terminada em `\n`. Máximo **1 MiB** por linha (acima: descartada + `protocol_error`).
- **stdout é exclusivo do protocolo.** O motor redireciona `sys.stdout` para stderr; `print()` em ações não corrompe o protocolo. Diagnóstico = **stderr** (o Main o registra em log).
- Linha inválida (não-JSON, sem `type`, tipo desconhecido) nunca derruba o processo: gera `protocol_error` e segue.
- EOF no stdin = o pai morreu: o motor cancela execuções e encerra.

## Envelopes
Node → Python (comando): `{"type", "requestId", "payload"}`.
Python → Node: `{"type", "requestId", "eventId", "payload"}` — `requestId` é o do comando que originou a mensagem (`""` se espontânea); `eventId` é inteiro crescente por processo.

## Comandos (Node → Python)
| type | payload | resposta |
|---|---|---|
| `ping` | `{}` | `pong` `{uptimeMs, activeExecutions}` |
| `execute_action` | `{executionId, nodeId, action, config}` | `action_started` → `action_progress`* → um terminal |
| `cancel` | `{executionId}` | `cancel_ack` `{executionId, found}`; a ação termina com `action_cancelled` |
| `shutdown` | `{}` | `bye`, depois o processo encerra |

`config` já chega **resolvido** (templates `{{variables.x}}` são resolvidos pelo interpretador no Node; o motor nunca avalia expressões).

## Eventos (Python → Node)
| type | payload |
|---|---|
| `ready` | `{engineVersion, protocolVersion, python, platform, actions[], optionalModules{nome:{version}}}` — primeira mensagem após iniciar |
| `action_started` | `{executionId, nodeId}` |
| `action_progress` | `{executionId, nodeId, percent?, message?}` |
| `action_completed` | `{executionId, nodeId, status:"success", outputs{}, next?, message?}` |
| `action_failed` | `{executionId, nodeId, error:{code, message, details?}}` — `message` é segura para o usuário; `details` é técnico |
| `action_cancelled` | `{executionId, nodeId}` |
| `protocol_error` | `{message}` |
| `bye` | `{}` |

Códigos de erro de ação: `ACTION_NOT_IMPLEMENTED`, `INVALID_CONFIG`, `BUSY`, `OUTPUT_NOT_SERIALIZABLE`, `INTERNAL_ERROR` e os definidos por cada ação (ver `docs/ACTIONS.md`). Um resultado maior que 1 MiB vira `protocol_error`: as ações truncam listas (`truncated: true`).

## Cancelamento e timeout
Cooperativo: `cancel` sinaliza o token da execução; ações longas consultam `ctx.cancelled` / usam `ctx.sleep()`. O Main aplica **timeout** por ação: ao estourar, envia `cancel`; se a ação não terminar em 3 s, **mata o processo** do motor (ação não cooperativa) e o reinicia — "quando tecnicamente possível" (`ARCHITECTURE.md §7.4`).

## Ciclo de vida (Main)
`starting → ready` (ao receber `ready`) · heartbeat `ping` a cada 5 s, 3 falhas seguidas = `unavailable` + reinício · queda do processo = `crashed` + reinício com recuo (até 3 tentativas em 60 s, depois `unavailable`) · `before-quit` envia `shutdown` e aguarda até 2 s antes de matar.
