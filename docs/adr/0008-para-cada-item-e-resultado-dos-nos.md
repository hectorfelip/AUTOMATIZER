# ADR 0008 — "Para cada item" e resultado dos nós nas expressões (Fase 4, etapa 2)

**Status:** proposta — aguardando validação no Windows e aval do Hector (itens ⚠️ ampliam o escopo)

## Contexto
O critério da Fase 4 ("uma automação útil de organização de arquivos") exige tratar **cada** arquivo de uma lista, e o roadmap não prevê isso. O Hector escolheu (ADR 0007) entregar o filtro com curinga primeiro e, depois, "Para cada item" + resultado dos nós. Esta etapa substitui a decisão 5 do ADR 0005 ("expressões: só `{{variables.nome}}`").

## Decisões
1. ⚠️ **Três formas de referência** em `{{ }}`, e só elas: `{{variables.nome}}`, `{{nodes.<id>.<resultado>[.caminho]}}` e `{{<item>[.caminho]}}` (item do laço, padrão `item`). Nada é avaliado: é leitura de caminho. Caminhos só aceitam identificadores e posições numéricas (`.0`); `__proto__`, `constructor` e `prototype` são recusados já na sintaxe, e a leitura só enxerga propriedades **próprias** (nunca protótipo, `length` ou métodos). Texto como `process.exit(1)`, `a['b']` ou `item + 1` é rejeitado.
2. ⚠️ **Novo nó `flow.foreach` ("Para cada item")**, no mesmo modelo do "Repetir" já aprovado: saídas `body`/`depois`, e **o fim do corpo volta à entrada**. Campos: `items` (referência inteira a uma lista) e `itemName` (fixo, padrão `item`, sem `variables`/`nodes`). A lista é lida **uma vez**, na primeira passagem. Aninhamento: nomes diferentes enxergam os dois itens; mesmo nome, o de dentro vale enquanto roda e o de fora volta depois.
3. **Resultados declarados no contrato do nó** (`results`: chave, rótulo, tipo e, para listas, as propriedades de cada item). `files.list` expõe `count`, `files` (cada item: `name, stem, extension, path, folder, size, modifiedAt`), `folder`, `truncated`; os demais nós expõem o que já devolviam. O laço expõe `index` e `count`.
4. **O validador checa tudo em tempo de desenho:** o nó e o resultado existem (com "Disponíveis: …"), valor simples não tem propriedades, lista inteira não cabe em texto, propriedade do item existe (`{{item.nmae}}` é erro), o item só vale **dentro do corpo do laço**, e "Lista" tem de ser a referência a uma lista. Usar o resultado de um nó que pode **não ter rodado antes** é só **aviso**; em execução, vira erro claro ("O nó X ainda não foi executado").
5. **Tipos:** referência "pura" preserva o tipo (número continua número) e é ajustada ao tipo do campo de destino; lista/objeto em campo de texto é erro com orientação ("use uma posição ou 'Para cada item'"), nunca `[object Object]`.
6. ⚠️ **Seletor "Inserir…"** no painel de propriedades: oferece só o que existe *naquele ponto* do fluxo (variáveis, resultados de nós que rodam antes, propriedades do item em escopo). Em texto/caminho acrescenta; em número/lista substitui.
7. **Motor:** `files.list` passou a devolver `stem` e `folder` por arquivo.
8. **Exemplos novos:** "Organizar por tipo de arquivo" (usa o laço) e "Backup somente se houver arquivos" (usa um resultado numa decisão), rodados pelo pipeline real nos testes.

## Fora do escopo (documentado)
Listas que não vêm de `files.list`; laço com condição de saída ("enquanto"); acumuladores/matemática; resultado de nó dentro de campos `literal`/`select`.

## Consequências
O formato do documento **não mudou** (`schemaVersion: 1`): as expressões são texto dentro de `config`. Fluxos da etapa 1 continuam válidos. O risco novo é a linguagem de expressões ter ficado maior; por isso o parser é restritivo (lista fechada de formas) e coberto por testes de ataque e por testes de mutação.
