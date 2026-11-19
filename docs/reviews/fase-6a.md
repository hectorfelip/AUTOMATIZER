# Revisão — Fase 6a (Importação e exportação) — cumulativa: Fases 1–5 + 6a

Verificação em Linux: `npm run check` e e2e completo (resultados no commit). ADR 0010.

| Critério | Status | Evidência |
|---|---|---|
| Fluxo exportado pode ser importado em outra instalação compatível | ✅ | e2e com **dois diretórios de dados**: exporta na A, importa na B; mesmos nós, conexões e variável |
| Importação nunca inicia execução automaticamente | ✅ | e2e e teste do serviço: 0 execuções após importar; importar só cria a automação |
| Mostrar resumo do conteúdo importado | ✅ | Diálogo com arquivo, data/versão do app, contagens, nós por tipo, política, problemas, aviso "só Windows" |
| Rejeitar schemas desconhecidos ou inválidos | ✅ | Testes: não-JSON, outro formato, `formatVersion` futura, `schemaVersion` futura, campos extras, arquivo gigante, nó malformado |

## Achados
1. **Bug real de IPC** (achado pelo e2e): `route` não suportava handler assíncrono → `An object could not be cloned`. Corrigido + teste de regressão.
2. Mutações: remover "token de uso único" e remover a checagem de `formatVersion` quebram testes (como devem).

## Segurança
Renderer nunca informa caminho (schema `strictObject` rejeita `path`; testado); só o Main abre diálogos; conteúdo validado fica no Main sob token; `strictObject` em todos os níveis; limite de tamanho antes de interpretar.

## Débitos / não verificado em Windows
Diálogos nativos de arquivo no Windows (aqui foram substituídos por stubs no e2e; o código real usa `dialog.showSaveDialog/showOpenDialog`). Exportar a partir do editor (hoje só pela lista) e "pacote com recursos" ficam para depois.
