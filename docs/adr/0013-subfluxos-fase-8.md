# ADR 0013 — Subfluxos reutilizáveis: "Chamar fluxo" (Fase 8)

**Status:** aprovada pelo Hector (propor ADR e implementar). Sem mudança no schema do documento nem no banco.

## Decisão
1. **Um subfluxo é outra automação.** O nó `flow.subflow` ("Chamar fluxo", categoria Controle) executa a **versão salva** de uma automação **ativa**, no mesmo processo de execução, e segue pela saída `success` (ou `error`, tratada como em qualquer nó).
2. **A interface do fluxo chamado são as suas variáveis** — sem novos campos no schema, sem nova versão do documento:
   - **Parâmetros:** chaves `arg.<variável>` na config do nó (texto; aceitam `{{ }}`), convertidas ao tipo declarado da variável no fluxo chamado. Vazio mantém o padrão. Parâmetro para variável que o fluxo chamado não declara é erro (aponta o nome).
   - **Retorno:** as variáveis finais do fluxo chamado, em `{{nodes.<id>.outputs.<variável>}}`; `{{nodes.<id>.status}}` diz como terminou. O contexto do chamado é **isolado** (o chamador não vê o que o chamado criou além do retorno).
3. **Validação:** o validador aceita as chaves `arg.*` como campos de texto com checagem de `{{ }}` (`dynamicFieldPrefix` na definição do nó) e recusa um fluxo que chama a si mesmo (`SUBFLOW_SELF`). O fluxo chamado é **validado de novo em execução**; se tiver erros não roda e o nó que chamou falha com a causa.
4. **Segurança de execução:** ciclos indiretos (A→B→A) são detectados **antes de rodar de novo** (`SUBFLOW_CYCLE`); profundidade máxima 5 (`SUBFLOW_DEPTH`). Cancelamento, tempo limite do fluxo de **fora** e política de erro valem durante o subfluxo; **a pausa dentro dele não consome o tempo limite de nenhum dos fluxos**. Falhas não-continuáveis (`ENGINE_CRASHED`, `TIMEOUT`…) mantêm seu código; as demais viram `SUBFLOW_FAILED` com "O fluxo “X” falhou (nó n): causa".
5. **Depuração e histórico:** eventos do fluxo chamado usam ids com prefixo (`chama/set`, `a/b/s`) e rótulo "Fluxo › Nó"; pausa, passo a passo e **breakpoints** (`chama/set`) entram no subfluxo; o histórico grava os nós internos. O contexto mostrado na pausa é o do fluxo em que se está.
6. **Provedor de fluxos:** o interpretador não conhece o banco; recebe um `SubflowProvider` (o Main usa `WorkflowService.subflowLookup`: existe? arquivado? nunca salvo? corrompido? → erro com o motivo).
7. **UI:** campo "Fluxo a chamar" (lista de automações ativas, sem o próprio), parâmetros gerados das variáveis do fluxo escolhido (com "Inserir…") e a lista do que volta; parâmetros órfãos aparecem com botão "Remover".

## Alternativas rejeitadas
- *Parâmetros/retornos declarados no schema* (`schemaVersion` 2 + migração): mais explícito, mas muda o formato do arquivo e das versões imutáveis sem necessidade comprovada; as variáveis já são tipadas e têm padrão.
- *Copiar o fluxo chamado para dentro do chamador:* perderia a reutilização (editar uma vez).

## Limitações / débitos
- Mudar o nome de uma variável no fluxo chamado quebra os chamadores (o editor mostra o parâmetro órfão; a execução falha apontando o nome). Não há análise de impacto entre fluxos.
- Todas as variáveis do chamado voltam (não há "variável privada").
- Ciclos só são detectados em execução (não em tempo de desenho).
- Excluir/arquivar um fluxo chamado só aparece como erro ao executar o chamador.
- A exportação leva só o fluxo exportado: os fluxos que ele chama **não** vão junto (importar o chamador em outra instalação exige importar os chamados e reescolher o fluxo no nó).
