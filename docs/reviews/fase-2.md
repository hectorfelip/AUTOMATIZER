# Revisão — Fase 2 (Editor visual) — cumulativa: Fases 0, 1 e 2

Verificação executada: `npm run check` ✅ (lint, typecheck, build, **140 testes Vitest**, pytest) e `npm run test:e2e` ✅ (**11 testes** no Electron real sob xvfb/Linux: 5 da Fase 1 + 6 do editor). Capturas de tela revisadas (claro/escuro).

## Critérios de aceite da Fase 2

| Critério | Status | Evidência |
|---|---|---|
| Montar um fluxo simples sem escrever código | ✅ Linux / ⚠️ Windows não verificado | e2e: arrasta da paleta, conecta handle→handle, configura pelo painel |
| Salvo e reaberto preservando nós, conexões e posições | ✅ | e2e fecha o app, reabre, e o documento relido é **idêntico** (inclui `visual.positions`); teste de serviço idem |
| Fluxos inválidos mostram erros específicos | ✅ | e2e: "Mover arquivo: o campo “Origem” é obrigatório.", variável inexistente, `{{ process.exit(1) }}` rejeitado; erro no campo, no nó (badge "Erro") e na lista |
| Mudanças não salvas são identificadas | ✅ | e2e: "● Alterações não salvas"; desfazer até o estado salvo limpa o indicador; guarda ao navegar e ao **fechar a janela** |

Tarefas do roadmap: 14/14 implementadas. Em ordem: React Flow, zoom/pan, biblioteca por categorias, arrastar e soltar (e clique), conexões validadas, painel de propriedades, início/fim, seleção/duplicação/exclusão, desfazer/refazer (Ctrl+Z/Y/Shift+Z, Ctrl+D, Delete, Ctrl+S), salvar/carregar versionado, visual separado do executável, schema versionado, validador.

## Regressão das Fases 0–1
Os 5 e2e da Fase 1 continuam passando. Uma asserção foi atualizada **de propósito**: o teste de segurança que fixa a API exposta ao renderer agora lista o grupo `workflows` (`load`, `save`); continua sendo trava (qualquer outra função nova quebra o teste). Migração 0002 aplica sobre bancos da Fase 1 sem perda.

## Bugs encontrados e corrigidos nesta fase
1. **App não abria** com os pacotes novos: o bundle do Main externalizava `workflow-*`/`node-registry` (código TS). O build passava; só o e2e pegou. Lista agora derivada do `package.json`.
2. **Não era possível conectar nós**: minha regra CSS de hover nos handles sobrescrevia o `transform` do React Flow; o handle "pulava" sob o cursor e o clique virava pan. Removida.
3. `fitView` ignorava o padding: na v13 número cru ≠ proporção; usar `"6%"`.
4. Salvar o mesmo fluxo depois de renomear a automação criava versão nova (o nome ia no JSON comparado). Achado por teste de serviço; o nome não conta mais.
5. Guarda de fechar janela bloqueava o próprio teste e2e (diálogo nativo): helper `closeApp`.

## Desvios dos docs-base / decisões que precisam de aprovação (ADR 0005)
1. ⚠️ `visual` como seção própria (o exemplo do doc tem `position` no nó; o texto e o roadmap pedem separação).
2. ⚠️ 18 contratos de nós, **incluindo os da Fase 4** (só contrato, sem executor).
3. Registro declarativo em vez de JSON Schema ("validação equivalente").
4. `@xyflow/react` 13.0.2 (API diferente da v12).

## Escopo do SPEC ainda não coberto
Copiar/colar, comentários e agrupamento visual (SPEC §4.3), edição de `settings` do fluxo na UI, persistir zoom/pan, favoritar/duplicar automação (Fase 1 do SPEC §4.2).

## Débitos técnicos / riscos
- **Acessibilidade:** conectar nós só funciona com mouse. SPEC §5 pede alternativa de teclado → proposta: seção "Saídas" no painel de propriedades com um seletor de destino por porta (também ajuda quem não acerta o handle de 12 px). **Peço aprovação.**
- Canvas fica estreito em janela de 1280 px (sidebar + paleta + painel somam ~750 px). Considerar recolher a sidebar do app no editor.
- Sem teste de desempenho do canvas com centenas de nós (o validador foi testado com 1500).
- `isDirty` serializa o documento a cada mudança (marcado com `ponytail:`).
- Sem testes de componente React; a cobertura da UI é e2e.
- Atribuição "React Flow" mantida visível (licença).

## Não verificável aqui (precisa do Hector no Windows)
Arrastar-e-soltar HTML5 dentro do Electron no Windows, atalhos (Ctrl), diálogo nativo ao fechar a janela, DPI/escala, fontes.
