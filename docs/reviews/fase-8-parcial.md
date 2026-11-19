# Revisão — Fase 8 (parcial: subfluxos e templates) — cumulativa: Fases 1–5, 6a, 6b, 7-web e 8-parcial

ADR 0013. **Não feito:** OCR, localizar texto/imagem, espera visual, API e documentação de plugins.

| Critério / tarefa | Estado | Evidência |
|---|---|---|
| Subfluxos recebem parâmetros e devolvem resultados | ✅ | 18 testes do interpretador + integração com banco real + e2e (parâmetro 41 → retorno 41) |
| Criar subfluxos reutilizáveis | ✅ | nó "Chamar fluxo", UI de parâmetros/retorno |
| Biblioteca de templates | ✅ parcial | +1 exemplo web (7 no total); formato final do pacote segue aberto |
| Ações visuais com timeout e limiar | ⏳ não iniciado | decisão de OCR aberta (ARCHITECTURE §15) |
| Plugins validados e carregados de forma controlada | ⏳ não iniciado | sem ADR de API de plugins |

## Achados
1. **Bug real:** breakpoints dentro de um fluxo chamado nunca casavam (o gate usava o id sem prefixo). Corrigido (caminho completo `a/b/nó`) + teste.
2. A pausa dentro do subfluxo pausava só o prazo do fluxo de dentro, não o dos de fora → o tempo limite de fora estourava com a execução pausada. Corrigido (`pauseWith`); **mutação** (remover) quebra o teste.
3. **Mutação** em `stack.includes` (ciclo) quebra o teste; sem ela A→B→A recursaria até a profundidade.
4. O executor falso dos testes não respeitava `signal` (o real respeita): ajustado para refletir o motor.

## Segurança / robustez
Ciclo e profundidade limitados; fluxo chamado revalidado (nunca roda inválido) e só versão salva e ativa; parâmetros só `arg.*` (texto), tipados pelo fluxo chamado; contexto isolado; cancelamento e prazos propagam.

## Débitos
Renomear variável do chamado quebra chamadores (sem análise de impacto); ciclos só em execução; exportar não leva os chamados; todas as variáveis do chamado voltam.
