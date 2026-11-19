# Revisão — Fase 7 (gravador) — ADR 0016

Verificação em Linux com o **processo gravador real** alimentado por uma fonte falsa de eventos (só com `AUTOMATION_ENGINE_TEST_ACTIONS=1`). O `pynput` foi validado por você no Windows (spike: 49 eventos).

| Critério | Estado | Evidência |
|---|---|---|
| Gravação revisada antes de virar fluxo | ✅ | e2e: revisão aparece sozinha ao parar; criar só depois |
| Usuário corrige as ações geradas | ✅ | editar X/texto/teclas/segundos, apagar, reordenar (e2e edita e apaga) |
| Excluir/mascarar campos sensíveis | ✅ | **modo senha**: processo nunca emite o caractere; teste prova que a senha não aparece em stdout, stderr, tela, **banco de dados** nem no fluxo |
| Indicador visual, pausa e parada | ⚠️ implementado; Hector deu "tudo certo" no teste geral, **sem confirmar item a item** (faixa, minimizar/restaurar, Ctrl+Alt+P/S) | faixa `alwaysOnTop` que não captura cliques; atalhos globais Ctrl+Alt+R/P/S; botões |
| Captura real de mouse/teclado no app | ✅ **Windows (Hector, 19/11, "tudo certo")** com o app rodando o motor congelado; antes disso, o conserto do `write EPIPE` | spike validou `pynput`; `verify-engine.py` passou com pynput congelado |

Testes: 14 pytest (processador e processo), 11 de conversão, 9 do serviço, criação, 7 do IPC, 4 e2e (gravar→revisar→criar; descartar; passos inválidos; fora do Windows). Nunca executa a automação criada (0 execuções).

## Achados
1. **Filtro por posição estava errado:** descartar cliques "dentro da janela do app" engoliria cliques reais de quem grava em outro programa (a janela minimizada mantém os mesmos `bounds`). Agora só se descarta o **clique recente e último** no botão Pausar/Parar do próprio app, e só se a ação partiu da interface.
2. **Faixa recarregada a cada evento** (dezenas de `loadURL` com `ERR_ABORTED` sem tratamento): agora só recarrega quando o texto muda e a rejeição é tratada; a faixa também não recebe pushes do app e não segura o app aberto ao sair.
3. **Corrida no renderer:** a resposta de uma ação é um retrato que pode chegar depois de um push mais novo; a tela agora busca o status fresco e consulta periodicamente enquanto há gravação.
4. **Causa de uma flutuação de e2e (~30%):** operações nativas de janela (minimizar/restaurar/faixa) **travavam o processo principal no xvfb** (sem gerenciador de janelas). Ficam desligadas sob a flag de teste (0 falhas em 15 execuções). **Consequência:** essas três operações **não são exercitadas pelo e2e** — dependem da sua validação no Windows.
5. Teto de 500 passos era ultrapassado por 1 (espera + clique): corrigido.

## Achados do teste real no Windows (Hector) — corrigidos
6. **`write EPIPE` derrubava o app ao parar com Ctrl+Alt+R:** o processo gravador termina sozinho com o atalho e o Main escrevia `stop` no `stdin` já fechado; o evento `error` do pipe não tinha tratador (uncaught exception). Agora toda escrita é protegida (`send()`), os streams têm tratador de `error`, e há testes (**mutação:** remover o tratador reproduz exatamente o `write EPIPE` do print).
7. **Auditoria de todos os atalhos e da digitação** (eventos no formato real do Windows): o adaptador usava `canonical()` em **toda** tecla, o que gravaria "A" como "a" e "!" como "1"; e no teclado **ABNT2** `/` e `?` são **AltGr+Q/W** (o Windows reporta Ctrl+Alt falsos), então seriam gravados como atalhos — e AltGr+R poderia disparar "Parar". Agora o processador separa o **caractere produzido** da **tecla-base** (só esta vale para atalhos), trata AltGr como modificador próprio e o modo senha também não vaza caracteres via AltGr. Testes: Ctrl+Alt+R/P/S (códigos de controle reais, esquerdo/direito, com Shift, pausado, em modo senha), Shift+letra/símbolo, AltGr, acentos/cedilha, Ctrl+S/C/Shift+T, Win+R, Alt+X, Enter/Tab/Esc/F5/setas/Backspace/Delete/PageDown (24 testes; mutações em AltGr e em "caractere produzido" são pegas).

## Riscos / débitos
Cliques por coordenada (frágeis com DPI); sem clique por elemento UIA; sem agrupamento de rolagem; texto com `{{ }}` digitado é recusado pelo validador (sem escape); `pynput` não empacotado no motor congelado; Ctrl+Alt+letra com `canonical()` não verificado no Windows.

## O que o Hector precisa validar no Windows
1. `python -m pip install -r engine\python\requirements-recorder.txt` e `npm run dev`.
2. **Gravador → Iniciar gravação:** o app deve minimizar e aparecer uma **faixa vermelha** no topo da tela, sem roubar o foco.
3. Abra o Bloco de Notas, clique nele e digite uma frase; ligue o **modo senha** (Ctrl+Alt+S, a faixa muda), digite algo, desligue; **Ctrl+Alt+R** para. O app deve voltar sozinho com a revisão.
4. Confira que o texto do modo senha **não** aparece em lugar nenhum, edite um passo e **Criar automação**; abra no editor e execute (Bloco de Notas aberto).
5. Teste **Ctrl+Alt+P** (pausa) e clicar em "Pausar"/"Parar e revisar" no app (o clique no botão não deve virar passo).
