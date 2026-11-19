# Plugins declarativos (ADR 0014)

Um **plugin** cria um **nó novo** combinando nós que o Automation Studio já tem. **Não traz código**: não roda Python, shell nem nada fora da lista de ações permitidas. É instalado só por **importação manual** (Plugins → Instalar plugin…), com um resumo antes de confirmar; pode ser desativado ou removido a qualquer momento.

## Como funciona
O plugin tem um **fluxo interno** (um fluxo comum, só com nós embutidos). Os **campos** do nó viram as **variáveis de mesmo nome** do fluxo interno (que definem tipo e valor padrão); os **retornos** são variáveis do fluxo interno que o nó expõe como resultados (`{{nodes.<id>.<retorno>}}`, mais `status`). É o mesmo contrato de "Chamar fluxo" (ADR 0013): contexto isolado, cancelamento e tempo limite herdados, pausa/passo a passo/breakpoints entram no fluxo interno e os passos aparecem no histórico como "Plugin › Nó".

## Formato (`*.asplugin.json`, UTF-8, até 512 KB)
```json
{
  "format": "automation-studio.plugin",
  "formatVersion": 1,
  "id": "saudacao",              // 2–40 caracteres: a–z, 0–9 e hífen; vira o nó "plugin.saudacao"
  "name": "Montar saudação",     // nome na paleta
  "version": "1.0.0",
  "description": "…",
  "fields":  [ { "key": "nome", "label": "Nome", "kind": "text", "required": true, "help": "…" } ],  // kind: text | number | boolean
  "returns": [ "saudacao" ],     // variáveis do fluxo interno devolvidas
  "flow":    { …documento de fluxo… }
}
```
Exemplo completo e validado nos testes: [`docs/examples/saudacao.asplugin.json`](examples/saudacao.asplugin.json).

## Regras (todas validadas na instalação; qualquer falha recusa o plugin inteiro)
- `format`/`formatVersion` conhecidos; **nenhum campo desconhecido** em lugar nenhum.
- O fluxo interno passa no validador (sem erros) e tem até 200 nós.
- **Só nós embutidos:** nada de outro plugin, de tipo desconhecido nem de **Chamar fluxo**.
- Cada campo precisa de uma variável de mesmo nome e **mesmo tipo** no fluxo interno; cada retorno precisa existir lá; `status` é reservado.
- O id nunca sobrepõe um nó embutido (o tipo é sempre `plugin.<id>`).
- Reinstalar o mesmo `id` **substitui** (a tela avisa a versão anterior) e mantém ativo/desativado.

## Criar um plugin na prática
1. Monte e teste o fluxo no editor como uma automação normal (variáveis = parâmetros, como em "Chamar fluxo").
2. Exporte (Automações → Exportar) e copie o objeto `workflow` do arquivo para o campo `flow` de um `*.asplugin.json`.
3. Declare `fields` e `returns` e instale em Plugins.

## Limites e segurança
- Um plugin **não amplia o que o app consegue fazer**; só reutiliza ações existentes. Plugins **com código** (opção B do ADR 0014) **não existem** e exigem decisão e requisitos de segurança próprios.
- Desativar/remover um plugin usado por uma automação a deixa **não executável** (nó desconhecido) até reinstalar; a tela avisa quantas automações o usam.
- Exportar uma automação **não leva** os plugins que ela usa (instale-os na outra máquina).
